// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// plausible.io (no address) or a self-hosted Plausible Community Edition (its
// address), a "Stats API" key, and the domains of the sites to follow: a key
// cannot list its sites (src/plausible/client.js).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Intervals between two reads of the visitors right now, in seconds.
export const POLL_INTERVALS = ['60', '120', '300'];

export const DEFAULT_CONFIG = {
  url: '',
  api_key: '',
  sites: '',
  poll_interval: '60',
  spike_threshold: 10,
  silence_hours: 24,
  language: 'fr',
};

export const MAX_SPIKE_THRESHOLD = 1_000_000;
export const MAX_SILENCE_HOURS = 720;
// Sites followed at most: each one costs requests (600 per hour on plausible.io).
export const MAX_SITES = 25;

// Pages of the Plausible interface: an address copied from the browser points
// at one of them, the API lives at the root.
const INTERFACE_PATH = /\/(sites|settings|login|register|share|api|billing|team|password)(\/.*)?$/i;

// The hosts of plausible.io.
const CLOUD_HOST = /^(www\.)?plausible\.io$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10:8000`), or a URL copied from the browser
 * (`https://stats.example.org/sites`, `https://stats.example.org/blog.example.org`).
 * HTTP by default for a bare host. A path is kept (a reverse proxy sub-path),
 * the interface pages and a dashboard (a domain) dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, '' for plausible.io,
 *   null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  const text = raw.trim();
  if (!text) {
    return '';
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  if (CLOUD_HOST.test(url.hostname)) {
    return '';
  }
  const path = url.pathname
    .replace(INTERFACE_PATH, '')
    // A dashboard: /<domain>[/…], the domain holding a dot.
    .replace(/\/[^/]*\.[^/]*(\/.*)?$/, '')
    .replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme), "plausible.io" for the cloud. */
export const hostOf = (url) => (url ? url.replace(/^https?:\/\//, '') : 'plausible.io');

/**
 * The domains typed by the user (commas, spaces or new lines between them), as
 * Plausible names the sites: lower case, without scheme, path or `www.` kept
 * as typed. A pasted address (`https://blog.example.org/`) gives its host.
 * @returns {string[]} distinct domains, MAX_SITES at most
 */
export function parseSites(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  const sites = [];
  for (const item of raw.split(/[\s,;]+/)) {
    const domain = item
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/[/?#].*$/, '');
    if (/^[\p{L}\p{N}][\p{L}\p{N}.-]*\.[\p{L}\p{N}-]+$/u.test(domain) && !sites.includes(domain)) {
      sites.push(domain);
    }
  }
  return sites.slice(0, MAX_SITES);
}

function integer(value, fallback, min, max) {
  const number = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : value;
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const pollInterval = POLL_INTERVALS.includes(String(source.poll_interval))
    ? String(source.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  return {
    url: parseServerUrl(source.url),
    // A pasted key often carries a trailing space or new line.
    apiKey: typeof source.api_key === 'string' ? source.api_key.trim() : '',
    sites: parseSites(source.sites),
    pollIntervalMs: Number(pollInterval) * 1000,
    spikeThreshold: integer(
      source.spike_threshold,
      DEFAULT_CONFIG.spike_threshold,
      1,
      MAX_SPIKE_THRESHOLD,
    ),
    silenceHours: integer(source.silence_hours, DEFAULT_CONFIG.silence_hours, 1, MAX_SILENCE_HOURS),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/**
 * What is missing to read Plausible, null when the configuration is complete:
 * 'invalidUrl', 'noKey' or 'noSites'.
 */
export function missingCredentials(config) {
  if (config.url === null) {
    return 'invalidUrl';
  }
  if (!config.apiKey) {
    return 'noKey';
  }
  return config.sites.length > 0 ? null : 'noSites';
}
