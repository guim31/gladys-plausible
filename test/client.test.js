// -----------------------------------------------------------------------------
// The Plausible client against the real answers of Plausible CE 3.2.1
// (test/fixtures/plausible), the requests it sends, and the errors. Also the
// parsing of the configuration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUD_URL,
  DAY_METRICS,
  ERROR_KINDS,
  PlausibleClient,
  PlausibleError,
  count,
  dayOf,
} from '../src/plausible/client.js';
import {
  MAX_SITES,
  missingCredentials,
  normalizeConfig,
  parseServerUrl,
  parseSites,
} from '../src/config.js';
import { FIXTURE, replay } from './helpers/replay.js';

const BASE = 'http://192.0.2.10:8000';
const KEY = 'k'.repeat(64);

test('the real answers of Plausible CE 3.2.1', async () => {
  const { request, calls } = replay();
  const client = new PlausibleClient({ url: BASE, apiKey: KEY, request });
  assert.equal(await client.realtime('blog.example.org'), 6);
  assert.deepEqual(await client.today('blog.example.org'), {
    day: '2026-10-24',
    visitors: 6,
    visits: 6,
    pageviews: 8,
    bounceRate: 67,
    visitDuration: 0,
  });
  assert.deepEqual(await client.topPage('blog.example.org'), { path: '/posts/hello', views: 6 });
  assert.equal(await client.visits('blog.example.org', 0, 1), 6);
  assert.deepEqual(await client.today('shop.example.org'), {
    day: '2026-10-24',
    visitors: 1,
    visits: 1,
    pageviews: 1,
    bounceRate: 100,
    visitDuration: 0,
  });

  // What was sent: the key in Bearer, JSON bodies the real server accepted.
  assert.equal(calls[0].url, `${BASE}/api/v1/stats/realtime/visitors?site_id=blog.example.org`);
  assert.equal(calls[0].method, 'GET');
  for (const call of calls) {
    assert.equal(call.headers.authorization, `Bearer ${KEY}`);
  }
  const day = JSON.parse(calls[1].body);
  assert.deepEqual(day, { site_id: 'blog.example.org', metrics: DAY_METRICS, date_range: 'day' });
  const recorded = FIXTURE.exchanges.find(
    (exchange) => exchange.request?.date_range === 'day' && !exchange.request.dimensions,
  );
  assert.deepEqual(day, recorded.request, 'the body recorded on the real server');
  const window = JSON.parse(calls[3].body);
  assert.deepEqual(window.date_range, ['1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.001Z']);
});

test('a refused key or site, a wrong address, a redirect, a rate limit, a down server', async () => {
  const { request } = replay();
  const client = new PlausibleClient({ url: BASE, apiKey: KEY, request });
  await assert.rejects(client.realtime('unknown.example.org'), { kind: ERROR_KINDS.AUTH });

  const answering =
    (status, body = '') =>
    async () => ({ status, body });
  const kindOf = async (status, body) => {
    try {
      await new PlausibleClient({
        url: BASE,
        apiKey: KEY,
        request: answering(status, body),
      }).today('blog.example.org');
    } catch (err) {
      assert.ok(err instanceof PlausibleError);
      assert.ok(!err.message.includes(KEY), 'the key never reaches a message');
      return err.kind;
    }
    return null;
  };
  const html = FIXTURE.exchanges.find((exchange) => exchange.status === 404).answer;
  assert.equal(await kindOf(404, html), ERROR_KINDS.NOT_PLAUSIBLE);
  assert.equal(await kindOf(200, '<html></html>'), ERROR_KINDS.NOT_PLAUSIBLE);
  assert.equal(await kindOf(200, '{"results":[]}'), ERROR_KINDS.NOT_PLAUSIBLE);
  assert.equal(await kindOf(301), ERROR_KINDS.REDIRECT);
  assert.equal(await kindOf(429), ERROR_KINDS.RATE_LIMIT);
  assert.equal(await kindOf(500), ERROR_KINDS.HTTP);
  assert.equal(await kindOf(403), ERROR_KINDS.AUTH);

  const failing = (cause) => async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause });
  };
  for (const [cause, kind] of [
    [{ code: 'ECONNREFUSED' }, ERROR_KINDS.UNREACHABLE],
    [{ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }, ERROR_KINDS.TLS],
  ]) {
    const down = new PlausibleClient({ url: BASE, apiKey: KEY, request: failing(cause) });
    await assert.rejects(down.realtime('blog.example.org'), { kind });
  }
});

test('a 400 keeps the explanation of Plausible for the logs', async () => {
  const body = JSON.stringify({ error: '#/date_range: Invalid date range "realtime"' });
  const client = new PlausibleClient({
    url: BASE,
    apiKey: KEY,
    request: async () => ({ status: 400, body }),
  });
  await assert.rejects(client.today('blog.example.org'), {
    kind: ERROR_KINDS.HTTP,
    message: 'Unexpected answer (HTTP 400): #/date_range: Invalid date range "realtime"',
  });
});

test('plausible.io by default, the requests of the last hour counted', async () => {
  const calls = [];
  const client = new PlausibleClient({
    url: '',
    apiKey: KEY,
    request: async (url) => {
      calls.push(url);
      return { status: 200, body: '3' };
    },
  });
  assert.equal(client.cloud, true);
  assert.equal(await client.realtime('blog.example.org'), 3);
  assert.ok(calls[0].startsWith(`${CLOUD_URL}/api/v1/`));
  assert.equal(client.sentLastHour(), 1);
  assert.equal(client.sentLastHour(Date.now() + 3600_000), 0);
});

test('counts and days', () => {
  assert.equal(count(5), 5);
  assert.equal(count('7'), 7);
  assert.equal(count(2.6), 3);
  assert.equal(count(-1), 0);
  assert.equal(count(null), 0);
  assert.equal(dayOf({ query: { date_range: ['2026-10-24T00:00:00+02:00', 'x'] } }), '2026-10-24');
  assert.equal(dayOf({}), null);
});

test('the address: bare host, copied URL, plausible.io, unusable', () => {
  assert.equal(parseServerUrl(''), '');
  assert.equal(parseServerUrl('https://plausible.io/blog.example.org'), '');
  assert.equal(parseServerUrl('192.0.2.10:8000'), 'http://192.0.2.10:8000');
  assert.equal(parseServerUrl('https://stats.example.org/'), 'https://stats.example.org');
  assert.equal(parseServerUrl('https://stats.example.org/sites'), 'https://stats.example.org');
  assert.equal(
    parseServerUrl('https://stats.example.org/blog.example.org?period=day'),
    'https://stats.example.org',
  );
  assert.equal(
    parseServerUrl('https://example.org/plausible/settings/api-keys'),
    'https://example.org/plausible',
  );
  assert.equal(parseServerUrl('ftp://stats.example.org'), null);
  assert.equal(parseServerUrl('https://user:secret@stats.example.org'), null);
  assert.equal(parseServerUrl('http://'), null);
});

test('the domains: separators, pasted addresses, duplicates, the limit', () => {
  assert.deepEqual(
    parseSites(
      ' Blog.example.org,shop.example.org\nhttps://docs.example.org/guide ; blog.example.org',
    ),
    ['blog.example.org', 'shop.example.org', 'docs.example.org'],
  );
  assert.deepEqual(parseSites('not-a-domain, , ...'), []);
  assert.deepEqual(parseSites('café.example.org'), ['café.example.org']);
  assert.deepEqual(parseSites(undefined), []);
  const many = Array.from({ length: 30 }, (_, n) => `s${n}.example.org`).join(' ');
  assert.equal(parseSites(many).length, MAX_SITES);
});

test('the configuration: defaults, bounds, what is missing', () => {
  const config = normalizeConfig({});
  assert.equal(config.url, '');
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.language, 'fr');
  assert.equal(missingCredentials(config), 'noKey');
  assert.equal(missingCredentials(normalizeConfig({ api_key: ' k \n' })), 'noSites');
  assert.equal(missingCredentials(normalizeConfig({ url: 'ftp://x', api_key: 'k' })), 'invalidUrl');
  const full = normalizeConfig({
    api_key: ' k ',
    sites: 'blog.example.org',
    poll_interval: '300',
    spike_threshold: '0',
    silence_hours: 9999,
    language: 'xx',
  });
  assert.equal(missingCredentials(full), null);
  assert.equal(full.apiKey, 'k');
  assert.equal(full.pollIntervalMs, 300_000);
  assert.equal(full.spikeThreshold, 1);
  assert.equal(full.silenceHours, 720);
  assert.equal(full.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: '30' }).pollIntervalMs, 60_000);
});
