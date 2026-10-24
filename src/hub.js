// -----------------------------------------------------------------------------
// The Plausible hub: the sites read on a timer of the container; the states of
// the added devices published when they change, the scene events fired on
// transitions, and the views the widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 5 minutes, beyond the fixed list of the core scheduler, and the scene
// events fire for every site, added to Gladys or not.
//
// Requests per site: the visitors right now at every cycle (the interval of
// the configuration); the figures of the day and the most viewed page every
// 15 minutes, or at once when a first visitor shows up; the visits of the last
// N hours (for "no visit for N hours") every 15 minutes when nobody is on the
// site. plausible.io accepts 600 requests per hour and key: there, the
// interval is stretched so that the integration keeps under 540.
//
// What the triggers remember is kept in /data (src/store.js): a restart
// neither announces a spike or a first visitor twice, nor misses a silence.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { buildSiteDevice, parseSiteId, siteIds, siteValues, topPageText } from './devices.js';
import { ERROR_KINDS, PlausibleClient, PlausibleError } from './plausible/client.js';
import { hostOf, missingCredentials, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'plausible-hub' });

export const WIDGET_KEY = 'plausible_today';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  SPIKE: 'visitor_spike',
  FIRST_VISITOR: 'first_visitor',
  SILENT: 'website_silent',
});

export const HUB_TIMINGS = {
  // The figures of the day and the most viewed page.
  dayEveryMs: 15 * 60_000,
  // The visits of the last N hours, for "no visit for N hours".
  silenceEveryMs: 15 * 60_000,
  // A second spike of the same site is announced after this pause at least,
  // even if the visitors went below the threshold in between.
  spikeCooldownMs: 30 * 60_000,
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads Plausible again when the last read is older.
  freshMs: 15_000,
};

// plausible.io: 600 requests per hour and key; the integration keeps a margin.
export const CLOUD_HOURLY_BUDGET = 540;
// Requests per site and hour besides the visitors right now: the day and the
// top page (4 + 4), the silence window (4 at most).
const HOURLY_EXTRA_PER_SITE = 12;

const MAX_TRANSPORTS_PER_REQUEST = 100;

/** The local day of `time` in the time zone of Gladys, `YYYY-MM-DD`. */
export function dayKey(time) {
  const date = new Date(time);
  const two = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * The interval between two reads: the one of the configuration, stretched on
 * plausible.io so that the sites fit in CLOUD_HOURLY_BUDGET.
 */
export function readIntervalMs(config, cloud) {
  const sites = config.sites.length;
  if (!cloud || sites === 0) {
    return config.pollIntervalMs;
  }
  const perHour = CLOUD_HOURLY_BUDGET - HOURLY_EXTRA_PER_SITE * sites;
  return Math.max(config.pollIntervalMs, Math.ceil((3600_000 * sites) / perHour / 1000) * 1000);
}

export class PlausibleHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/plausible/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    /** @type {Map<string, object>} the sites of the configuration, by domain */
    this.sites = new Map();
    this.readAt = 0;
    this.error = null;
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = { sites: {} };
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const sites = saved?.sites;
    this.saved = { sites: sites && typeof sites === 'object' ? sites : {} };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    const languageChanged = this.signature !== null && previous.language !== config.language;
    this.config = config;
    const signature = JSON.stringify([config.url, config.apiKey]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.client =
        config.url !== null && config.apiKey
          ? new PlausibleClient({ url: config.url, apiKey: config.apiKey, request: this.request })
          : null;
      this.sites = new Map();
      this.readAt = 0;
      this.error = null;
      this.polling = null;
    }
    // The sites of the configuration: the known ones keep their figures.
    const sites = new Map();
    for (const domain of config.sites) {
      sites.set(domain, this.sites.get(domain) ?? blankSite(domain));
    }
    this.sites = sites;
    if (previous.silenceHours !== config.silenceHours) {
      for (const site of this.sites.values()) {
        site.silenceAt = 0; // read the new window at the next cycle
      }
    }
    if (languageChanged) {
      this.discovered = null; // new names for the Discovery tab
    }
    // A read in progress uses the previous list: let it end, then read again.
    await this.polling?.catch(() => {});
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  /** The interval between two reads (stretched on plausible.io, see readIntervalMs). */
  intervalMs() {
    return readIntervalMs(this.config, this.client?.cloud ?? false);
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client || this.sites.size === 0) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading Plausible works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.intervalMs());
  }

  // --- Reading Plausible ------------------------------------------------------------

  /** Read Plausible now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read failed or is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    const limited = this.error?.kind === ERROR_KINDS.RATE_LIMIT;
    if (
      this.client &&
      ((this.error && !limited) || this.now() - this.readAt >= this.timings.freshMs)
    ) {
      await this.pollNow();
    }
  }

  /**
   * Read Plausible and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client || this.sites.size === 0) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    try {
      await this.readSites(client);
    } catch (err) {
      if (!(err instanceof PlausibleError)) {
        throw err;
      }
      return client === this.client && this.applyFailure(err);
    }
    return client === this.client && this.applySuccess();
  }

  /**
   * Every site of the configuration. Plausible refuses a wrong key and a site
   * the key cannot read alike (401): every site refused is a key problem, some
   * of them a domain problem (a typo, a site of another account).
   */
  async readSites(client) {
    const now = this.now();
    let refusal = null;
    const refused = new Set();
    for (const site of [...this.sites.values()]) {
      try {
        await this.readSite(client, site, now);
      } catch (err) {
        if (!(err instanceof PlausibleError && err.kind === ERROR_KINDS.AUTH)) {
          throw err;
        }
        refusal = err;
        refused.add(site);
      }
    }
    if (refusal && refused.size === this.sites.size) {
      // Every site refused: the key, one error (the per-site flags stay).
      throw refusal;
    }
    for (const site of this.sites.values()) {
      const now = refused.has(site);
      if (now && !site.refused && client === this.client) {
        logger.warn(`${site.id}: not readable with this key (unknown domain, or another account)`);
      }
      site.refused = now;
    }
  }

  async readSite(client, site, now) {
    const active = await client.realtime(site.id);
    const localDay = dayKey(now);
    const dayDue =
      !site.today ||
      now - site.dayAt >= this.timings.dayEveryMs ||
      site.localDay !== localDay ||
      // The day of the site is over (its time zone may not be the one of Gladys).
      (site.dayEnd !== null && now >= site.dayEnd + 1000) ||
      // A first visitor: the figures of the day at once.
      (active > 0 && site.today.visitors === 0);
    let { today, day, dayEnd, topPage, dayAt } = site;
    if (dayDue) {
      today = await client.today(site.id);
      day = today.day ?? localDay;
      dayEnd = today.dayEnd;
      const top = today.pageviews > 0 ? await client.topPage(site.id) : null;
      topPage = top?.path ?? null;
      dayAt = now;
    }
    // Visitors right now, or a new visit today: not silent, no request needed.
    let silent = site.silent;
    let silenceAt = site.silenceAt;
    const newVisit = site.today && site.day === day && today.visits > site.today.visits;
    if (active > 0 || newVisit) {
      silent = false;
      silenceAt = now;
    } else if (!silenceAt || now - silenceAt >= this.timings.silenceEveryMs) {
      const visits = await client.visits(site.id, now - this.config.silenceHours * 3600_000, now);
      silent = visits === 0;
      silenceAt = now;
    }
    // Applied at the end: a failed request leaves the site as it was.
    Object.assign(site, {
      active,
      today,
      day,
      dayEnd,
      localDay,
      topPage,
      dayAt,
      silent,
      silenceAt,
    });
  }

  /** The sites read with success (not refused by Plausible). */
  readable() {
    return [...this.sites.values()].filter((site) => site.today && !site.refused);
  }

  async applySuccess() {
    const firstRead = this.readAt === 0;
    let widgetChanged = this.error !== null || firstRead;
    if (this.error) {
      logger.info('Plausible answers again');
    }
    if (firstRead) {
      logger.info(
        `Plausible (${hostOf(this.config.url)}): ${this.readable().length}/${this.sites.size} site(s) readable`,
      );
    }
    this.error = null;
    this.readAt = this.now();
    const signature = JSON.stringify([...this.sites.values()].map(widgetSignature));
    if (signature !== this.widgetSignature) {
      this.widgetSignature = signature;
      widgetChanged = true;
    }

    let dirty = false;
    for (const site of this.readable()) {
      dirty = (await this.transition(site)) || dirty;
    }
    // A site removed from the configuration is forgotten.
    for (const id of Object.keys(this.saved.sites)) {
      if (!this.sites.has(id)) {
        delete this.saved.sites[id];
        dirty = true;
      }
    }
    // Written only when something changed: no wear of the SD card at every read.
    if (dirty) {
      this.store.save(this.saved);
    }
    await this.publishStates();
    return widgetChanged;
  }

  applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Plausible: ${err.message}`);
    }
    return wasError !== err.kind;
  }

  /**
   * Compare a site with what the triggers remember; fire the scene events.
   * The first sight of a site only records its state.
   * @returns {boolean} whether the saved state changed
   */
  async transition(site) {
    const now = this.now();
    const first = !this.saved.sites[site.id];
    const saved = this.saved.sites[site.id] ?? { spike: false, spikeAt: 0, firstDay: null };
    const before = JSON.stringify(saved);
    const threshold = this.config.spikeThreshold;

    if (site.active >= threshold) {
      if (first) {
        saved.spike = true; // under way before the integration saw it
      } else if (!saved.spike && now - (saved.spikeAt || 0) >= this.timings.spikeCooldownMs) {
        // A spike starting during the pause is announced once the pause is
        // over, if it still lasts.
        saved.spike = true;
        saved.spikeAt = now;
        logger.info(`${site.name}: ${site.active} visitors right now`);
        await this.fire(TRIGGERS.SPIKE, site, { visitors: site.active, threshold });
      }
    } else if (saved.spike) {
      saved.spike = false;
    }

    // The first visitor is announced when the integration saw the site
    // without a visitor that day shortly before: not after an outage, a
    // refused period or a long stop, when the visits arrived unseen.
    if (site.today?.visitors === 0) {
      saved.zeroDay = site.day;
      saved.zeroAt = now;
    } else if (site.today?.visitors > 0 && saved.firstDay !== site.day) {
      saved.firstDay = site.day;
      const seenEmpty =
        saved.zeroDay === site.day &&
        now - (saved.zeroAt || 0) <= this.timings.dayEveryMs + this.intervalMs() + 60_000;
      if (!first && seenEmpty) {
        await this.fire(TRIGGERS.FIRST_VISITOR, site, { visitors: site.today.visitors });
      }
    }

    if (typeof site.silent === 'boolean' && saved.silent !== site.silent) {
      const was = saved.silent;
      saved.silent = site.silent;
      if (was === false && site.silent) {
        logger.info(`${site.name}: no visit for ${this.config.silenceHours} h`);
        await this.fire(TRIGGERS.SILENT, site, { hours: this.config.silenceHours });
      }
    }

    this.saved.sites[site.id] = saved;
    return first || JSON.stringify(saved) !== before;
  }

  async fire(key, site, extra = {}) {
    const data = {
      device: siteIds(this.gladys, site.id).device,
      domain: site.id,
      ...extra,
    };
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /** Publish the Discovery list when it changed (a site added, removed…). */
  async publishDevices({ force = false } = {}) {
    let devices;
    if (!this.client) {
      devices = [];
    } else if (this.readAt === 0 || this.error) {
      return; // nothing read: keep the list Gladys has
    } else {
      devices = this.readable().map((site) =>
        buildSiteDevice(this.gladys, site, this.config.language),
      );
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the sites again, publish the list. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: send all its states (the SDK forgot
   * what it had published for it), and its badge.
   */
  async onDeviceCreated(device) {
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    if (this.readAt === 0 || this.error) {
      return;
    }
    const states = [];
    for (const site of this.sites.values()) {
      if (!site.refused && this.isCreated(siteIds(this.gladys, site.id).device)) {
        states.push(...siteValues(this.gladys, site));
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: cloud or local, or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    let transport = this.config.url ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.CLOUD;
    if (this.error) {
      transport = DEVICE_TRANSPORTS.UNREACHABLE;
    }
    const entries = [];
    for (const [id, site] of this.sites) {
      const externalId = siteIds(this.gladys, id).device;
      const badge = site.refused ? DEVICE_TRANSPORTS.UNREACHABLE : transport;
      if (this.isCreated(externalId) && this.transports.get(externalId) !== badge) {
        entries.push({ external_id: externalId, transport: badge });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    const missing = missingCredentials(this.config);
    if (missing) {
      return { connected: false, message: CONNECTION_TEXT[missing] };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene actions, report) ------------------------------------------

  /** The site of a device external id, null when it is not one (or no longer followed). */
  find(externalId) {
    const id = parseSiteId(this.gladys, externalId);
    return id ? (this.sites.get(id) ?? null) : null;
  }

  /** Throws the reason Plausible cannot answer, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, this.config.language));
    }
  }

  /** "Test the connection": read Plausible now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const message = {};
    const sites = this.readable();
    const refused = [...this.sites.values()].filter((site) => site.refused).map((site) => site.id);
    const sum = (read) => sites.reduce((total, site) => total + (read(site) ?? 0), 0);
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const status = this.connectionStatus();
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const parts = [
        text.ok,
        text.websites(sites.length),
        text.visitors(sum((site) => site.today?.visitors)),
        text.active(sum((site) => site.active)),
      ];
      if (refused.length > 0) {
        parts.push(text.refused(refused.join(' ')));
      }
      message[language] = labelled('Plausible', parts.join(', '), language);
    }
    return message;
  }
}

/** A site not read yet. */
export function blankSite(domain) {
  return {
    id: domain,
    name: domain,
    active: null,
    today: null,
    day: null,
    dayEnd: null,
    localDay: null,
    dayAt: 0,
    topPage: null,
    silent: null,
    silenceAt: 0,
    refused: false,
  };
}

/** What the widget shows of a site: it is refreshed when this changes. */
const widgetSignature = (site) => [
  site.id,
  site.name,
  site.active,
  site.today?.visitors,
  site.today?.visits,
  site.today?.pageviews,
  site.today?.bounceRate,
  site.today?.visitDuration,
  site.refused,
  topPageText(site),
];
