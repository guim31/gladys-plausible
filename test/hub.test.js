// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake Plausible: discovery,
// states, scene triggers, persistence across restarts, errors, quiet logs, the
// widget, the scene action and the reading timer of the container.
// (Adapted from guim31/gladys-umami.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS } from '../src/devices.js';
import { normalizeConfig } from '../src/config.js';
import { HUB_TIMINGS, TRIGGERS, WIDGET_KEY, readIntervalMs } from '../src/hub.js';
import {
  API_KEY,
  BASE,
  FakePlausible,
  createClock,
  createDevices,
  createWorld,
  idsOf,
  site,
} from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const MINUTE = 60_000;
const BLOG = 'blog.example.org';
const SHOP = 'shop.example.org';
const config = (extra = {}) => ({
  url: BASE,
  api_key: API_KEY,
  sites: `${BLOG}, ${SHOP}`,
  language: 'en',
  ...extra,
});

/** What the fake received, in short: realtime, day, top or window. */
const kinds = (world) =>
  world.plausible.requests.map((r) => {
    if (r.path.endsWith('/realtime/visitors')) {
      return 'realtime';
    }
    if (r.body.dimensions) {
      return 'top';
    }
    return r.body.date_range === 'day' ? 'day' : 'window';
  });

test('one device per site, proposed in Discovery, nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    [BLOG, SHOP],
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
    assert.equal(device.features.length, 7);
  }
  assert.deepEqual(devices[0].params, [{ name: 'DOMAIN', value: BLOG }]);
  assert.equal(world.fake.states.length, 0, 'nothing published for devices not added');
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the states of an added device, at once, then only the changes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const ids = idsOf(world, BLOG);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.ACTIVE)), 2);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.VISITORS)), 12);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.VISITS)), 15);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.PAGEVIEWS)), 41);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.BOUNCE_RATE)), 40);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.VISIT_DURATION)), 75);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.TOP_PAGE)), '/posts/hello');
  const shop = idsOf(world, SHOP);
  assert.equal(world.fake.lastState(shop.feature(FEATURE_KEYS.TOP_PAGE)), '-');
  assert.equal(world.fake.lastState(shop.feature(FEATURE_KEYS.BOUNCE_RATE)), 0);
  assert.deepEqual(
    [...new Set(world.fake.transports.map((entry) => entry.transport))],
    ['local'],
    'a self-hosted server is local',
  );

  const before = world.fake.states.length;
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(world.fake.states.length, before, 'nothing changed, nothing sent');

  world.plausible.set(BLOG, { active: 5 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(world.fake.states.length, before + 1);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.ACTIVE)), 5);
});

test('requests: the visitors right now at each cycle, the day every 15 minutes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  // First read: Blog (realtime, day, top), Shop (realtime, day, no top: no
  // page view, window: nobody on the site).
  assert.deepEqual(kinds(world), ['realtime', 'day', 'top', 'realtime', 'day', 'window']);
  world.plausible.requests = [];
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.deepEqual(kinds(world), ['realtime', 'realtime']);
  world.plausible.requests = [];
  world.clock.advance(HUB_TIMINGS.dayEveryMs);
  await world.hub.pollNow();
  assert.deepEqual(kinds(world), ['realtime', 'day', 'top', 'realtime', 'day', 'window']);
  assert.ok(world.plausible.requests.every((r) => r.url.startsWith(`${BASE}/api/`)));
});

test('a first visitor reads the figures of the day at once', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.plausible.set(SHOP, { active: 1 });
  world.plausible.setToday(SHOP, { visitors: 1, visits: 1, pageviews: 1 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(world.fake.lastState(idsOf(world, SHOP).feature(FEATURE_KEYS.VISITORS)), 1);
  assert.deepEqual(
    events(world, TRIGGERS.FIRST_VISITOR).map((event) => event.data),
    [{ device: idsOf(world, SHOP).device, domain: SHOP, visitors: 1 }],
  );
});

test('the daily counters follow midnight of Gladys at once', async (t) => {
  const clock = createClock(new Date(2026, 9, 15, 23, 58).getTime());
  const world = await createWorld({ clock });
  t.after(() => world.app.stop());
  await createDevices(world);
  const ids = idsOf(world, BLOG);
  world.plausible.setToday(BLOG, { pageviews: 0, visitors: 0, visits: 0, bounce_rate: 0 });
  world.plausible.set(BLOG, { topPath: null, active: 0, day: '2026-10-16' });
  clock.advance(3 * MINUTE);
  await world.hub.pollNow();
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.VISITORS)), 0);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.TOP_PAGE)), '-');
});

test('visitor spike: once when the threshold is crossed, again after the pause', async (t) => {
  const world = await createWorld({ config: config({ spike_threshold: 10 }) });
  t.after(() => world.app.stop());
  world.plausible.set(BLOG, { active: 12 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.deepEqual(events(world, TRIGGERS.SPIKE).at(-1)?.data, {
    device: idsOf(world, BLOG).device,
    domain: BLOG,
    visitors: 12,
    threshold: 10,
  });
  world.plausible.set(BLOG, { active: 15 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SPIKE).length, 1, 'still the same spike');
  // Down and up again within 30 minutes: no second event.
  world.plausible.set(BLOG, { active: 3 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  world.plausible.set(BLOG, { active: 11 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SPIKE).length, 1, 'within the pause');
  world.plausible.set(BLOG, { active: 2 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  world.clock.advance(HUB_TIMINGS.spikeCooldownMs);
  world.plausible.set(BLOG, { active: 20 });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SPIKE).length, 2);
});

test('a spike under way when the integration starts is not announced', async (t) => {
  const plausible = new FakePlausible();
  plausible.set(BLOG, { active: 50 });
  const world = await createWorld({ plausible });
  t.after(() => world.app.stop());
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SPIKE).length, 0);
});

test('a spike that starts during the pause is announced once the pause is over', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const poll = async (active, ms = MINUTE) => {
    world.plausible.set(BLOG, { active });
    world.clock.advance(ms);
    await world.hub.pollNow();
  };
  await poll(12);
  await poll(2);
  await poll(50);
  assert.equal(events(world, TRIGGERS.SPIKE).length, 1, 'still in the pause');
  await poll(50, HUB_TIMINGS.spikeCooldownMs);
  assert.equal(events(world, TRIGGERS.SPIKE).length, 2);
  await poll(60);
  assert.equal(events(world, TRIGGERS.SPIKE).length, 2, 'the same spike');
});

test('first visitor of the day: once a day, on the day of the site, not at the first start', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(events(world, TRIGGERS.FIRST_VISITOR).length, 0, 'Blog had visitors already');
  world.plausible.setToday(SHOP, { visitors: 1, visits: 1, pageviews: 1 });
  world.clock.advance(HUB_TIMINGS.dayEveryMs);
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.FIRST_VISITOR).map((event) => event.data.domain),
    [SHOP],
  );
  world.plausible.setToday(SHOP, { visitors: 3 });
  world.clock.advance(HUB_TIMINGS.dayEveryMs);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.FIRST_VISITOR).length, 1);
  // The next day of the sites.
  for (const domain of [BLOG, SHOP]) {
    world.plausible.set(domain, { day: '2026-10-16' });
  }
  world.clock.advance(HUB_TIMINGS.dayEveryMs);
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.FIRST_VISITOR).map((event) => event.data.domain),
    [SHOP, BLOG, SHOP],
  );
});

test('no visit for N hours: when the window empties, once, and again after visits', async (t) => {
  const world = await createWorld({ config: config({ silence_hours: 6 }) });
  t.after(() => world.app.stop());
  const window = () =>
    world.plausible.requests.filter(
      (r) => r.body?.site_id === SHOP && Array.isArray(r.body.date_range),
    );
  assert.equal(window().length, 1);
  assert.deepEqual(window()[0].body.date_range, [
    new Date(world.clock.now() - 6 * 3600_000).toISOString(),
    new Date(world.clock.now()).toISOString(),
  ]);
  world.plausible.set(SHOP, { recentVisits: 0 });
  world.clock.advance(5 * MINUTE);
  await world.hub.pollNow();
  assert.equal(window().length, 1, 'read every 15 minutes');
  world.clock.advance(10 * MINUTE);
  await world.hub.pollNow();
  assert.deepEqual(events(world, TRIGGERS.SILENT).at(-1)?.data, {
    device: idsOf(world, SHOP).device,
    domain: SHOP,
    hours: 6,
  });
  world.clock.advance(15 * MINUTE);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SILENT).length, 1, 'once');
  // A visitor: not silent any more, without asking Plausible.
  world.plausible.set(SHOP, { active: 1 });
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  world.plausible.set(SHOP, { active: 0 });
  world.clock.advance(15 * MINUTE);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SILENT).length, 2);
});

test('a site silent since before the start is not announced', async (t) => {
  const plausible = new FakePlausible();
  plausible.set(SHOP, { recentVisits: 0 });
  const world = await createWorld({ plausible });
  t.after(() => world.app.stop());
  world.clock.advance(20 * MINUTE);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SILENT).length, 0);
});

test('a restart neither announces a spike twice nor forgets the day', async (t) => {
  const first = await createWorld();
  first.plausible.set(BLOG, { active: 30 });
  first.clock.advance(MINUTE);
  await first.hub.pollNow();
  await first.app.stop();
  assert.equal(events(first, TRIGGERS.SPIKE).length, 1);

  const second = await createWorld({
    plausible: first.plausible,
    clock: first.clock,
    dataDir: first.dataDir,
  });
  t.after(() => second.app.stop());
  second.clock.advance(MINUTE);
  await second.hub.pollNow();
  assert.equal(events(second, TRIGGERS.SPIKE).length, 0);
  assert.equal(events(second, TRIGGERS.FIRST_VISITOR).length, 0);
  // A site added to the configuration after a restart only records.
  second.plausible.sites.push(site('new.example.org', { active: 99 }));
  await second.fake.configUpdated(config({ sites: `${BLOG}, ${SHOP}, new.example.org` }));
  assert.equal(events(second, TRIGGERS.SPIKE).length, 0);
  assert.equal(second.fake.discoveredDevices.length, 3);
});

test('Plausible down: unreachable badge and status, one warning, back to normal', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.plausible.failure = 'down';
  const lines = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      world.clock.advance(MINUTE);
      await world.hub.pollNow();
    }
  });
  assert.equal(lines.length, 1, 'one line for an outage, not one per read');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(world.fake.connectionStatus.message.fr, 'Plausible ne répond pas');
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  world.plausible.failure = null;
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
});

test('too many requests (429): a clear status', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.plausible.failure = 429;
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.match(world.fake.connectionStatus.message.en, /too many requests/);
});

test('a normal cycle writes nothing at the info level', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const sent = world.fake.states.length;
  const lines = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 6; cycle += 1) {
      world.plausible.set(BLOG, { active: 3 + cycle });
      world.plausible.setToday(BLOG, { visitors: 13 + cycle, pageviews: 44 + cycle });
      world.clock.advance(5 * MINUTE);
      await world.hub.pollNow();
    }
  });
  assert.ok(world.fake.states.length > sent, 'states were published');
  assert.deepEqual(lines, []);
});

test('missing key or sites, or a refused key: a clear status, no device', async (t) => {
  const empty = await createWorld({ config: { language: 'en' } });
  t.after(() => empty.app.stop());
  assert.equal(empty.fake.connectionStatus.connected, false);
  assert.match(empty.fake.connectionStatus.message.en, /Stats API key/);
  assert.deepEqual(empty.fake.discoveredDevices, []);

  const noSites = await createWorld({ config: config({ sites: ' , ' }) });
  t.after(() => noSites.app.stop());
  assert.match(noSites.fake.connectionStatus.message.en, /domains/);

  const refused = await createWorld({ config: config({ api_key: 'wrong' }) });
  t.after(() => refused.app.stop());
  assert.equal(refused.fake.connectionStatus.connected, false);
  assert.match(refused.fake.connectionStatus.message.en, /refused/);
  assert.deepEqual(refused.fake.discoveredDevices, []);
});

test('a domain Plausible refuses: left out, one warning, the others read', async (t) => {
  const lines = [];
  const world = await createWorld({
    connect: false,
    config: config({ sites: `${BLOG}, typo.example.org` }),
  });
  t.after(() => world.app.stop());
  lines.push(
    ...(await captureLogs(t, 'info', async () => {
      await world.gladys.connect();
      await world.app.ready;
      world.clock.advance(MINUTE);
      await world.hub.pollNow();
    })),
  );
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.deepEqual(
    world.fake.discoveredDevices.map((d) => d.name),
    [BLOG],
  );
  assert.equal(lines.filter((line) => line.includes('typo.example.org')).length, 1);
  const ack = await world.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /not readable with this key: typo\.example\.org$/);
});

test('plausible.io: the cloud address, the cloud badge, the interval stretched', async (t) => {
  const plausible = new FakePlausible();
  const world = await createWorld({
    plausible,
    config: config({ url: 'https://plausible.io/sites' }),
  });
  t.after(() => world.app.stop());
  assert.ok(plausible.requests.every((r) => r.url.startsWith('https://plausible.io/api/')));
  await createDevices(world);
  assert.equal(world.fake.transports.at(-1).transport, 'cloud');
  // 2 sites at 1 minute: 2 × (60 + 12) = 144 requests per hour, under the budget.
  assert.equal(world.hub.intervalMs(), MINUTE);
  const many = Array.from({ length: 20 }, (_, n) => `site${n}.example.org`).join(',');
  // 20 sites: 540 - 240 = 300 realtime requests per hour, one cycle every 4 minutes.
  assert.equal(readIntervalMs(normalizeConfig({ sites: many }), true), 4 * MINUTE);
  assert.equal(readIntervalMs(normalizeConfig({ sites: many }), false), MINUTE);
});

test('reconfiguring the language renames the features proposed in Discovery', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.configUpdated(config({ language: 'fr' }));
  const names = world.fake.discoveredDevices[0].features.map((f) => f.name);
  assert.ok(names.includes('Visiteurs en ce moment'));
});

test('a site removed from the configuration disappears from Discovery', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.configUpdated(config({ sites: BLOG }));
  assert.deepEqual(
    world.fake.discoveredDevices.map((d) => d.name),
    [BLOG],
  );
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the widget: totals, one row per site, valid content in every language', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language });
    assert.equal(ack.success, true, ack.error);
    const { content } = ack.data;
    validateWidgetContent(content);
    const values = content.components.filter((c) => c.type === 'value').map((c) => c.value);
    assert.deepEqual(values, [2, 12, 15, 41]);
    const rows = content.components.find((c) => c.type === 'status').items;
    assert.deepEqual(
      rows.map((row) => row.label),
      [BLOG, SHOP],
    );
    assert.ok(content.components.length <= 8);
  }
  await createDevices(world);
  const one = await world.fake.widgetGet(WIDGET_KEY, {
    settings: { websites: [idsOf(world, BLOG).device] },
    language: 'en',
  });
  const caption = one.data.content.components.find((c) => c.type === 'text');
  assert.equal(caption.text, 'Most viewed page: /posts/hello');
  assert.equal(
    one.data.content.components.find((c) => c.type === 'status'),
    undefined,
  );

  const refreshed = await world.fake.widgetAction(WIDGET_KEY, 'refresh', {});
  assert.equal(refreshed.success, true, refreshed.error);
});

test('the widget asks for the key and sites when nothing is configured', async (t) => {
  const world = await createWorld({ config: { language: 'en' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'de' });
  assert.match(ack.data.content.components[0].text, /Plausible-Schlüssel/);
});

test('the scene action reads the figures and writes a sentence', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('get_website_stats', {
    device: idsOf(world, BLOG).device,
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    name: BLOG,
    active: 2,
    visitors: 12,
    visits: 15,
    pageviews: 41,
    bounce_rate: 40,
    visit_duration: 75,
    top_page: '/posts/hello',
    sentence:
      'blog.example.org: 12 visitor(s) and 41 page view(s) today, 2 right now, most viewed page /posts/hello.',
  });
  const unknown = await world.fake.sceneAction('get_website_stats', { device: 'other:1' });
  assert.equal(unknown.success, false);
});

test('the scene action reads Plausible again right after an outage', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.plausible.failure = 'down';
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, false);
  world.plausible.failure = null;
  world.clock.advance(1000); // well before the next cycle
  const ack = await world.fake.sceneAction('get_website_stats', {
    device: idsOf(world, BLOG).device,
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.outputs.visitors, 12);
});

test('"Test the connection" answers one line per language', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    ack.data.message.en,
    'Plausible: Connected, 2 site(s), 12 visitor(s) today, 2 right now',
  );
  assert.match(ack.data.message.fr, /^Plausible : Connecté/);
});

test('the container reads Plausible on its own timer, without Gladys polling', async (t) => {
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  await createDevices(world);
  world.hub.config.pollIntervalMs = 20;
  world.hub.schedulePoll();
  world.plausible.set(BLOG, { active: 7 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(world.fake.lastState(idsOf(world, BLOG).feature(FEATURE_KEYS.ACTIVE)), 7);
});

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}
