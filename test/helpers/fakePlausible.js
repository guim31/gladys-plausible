// -----------------------------------------------------------------------------
// An in-memory Plausible: its sites and figures rendered like the Stats API of
// Plausible CE 3.2.1 (checked against the real answers of
// test/fixtures/plausible in test/client.test.js). Like the real one, a wrong
// key and a site the key cannot read both answer 401 with the same message.
// -----------------------------------------------------------------------------

export const BASE = 'http://192.0.2.10:8000';
export const API_KEY = 'statskey-not-a-real-key-0123456789abcdef0123456789abcdef01234567';

const REFUSED = JSON.stringify({
  error:
    "Invalid API key or site ID. Please make sure you're using a valid API key with access to the site you've requested.",
});

/** A site of the fake, with a quiet day. */
export function site(domain, fields = {}) {
  return {
    domain,
    active: 0,
    today: { visitors: 0, visits: 0, pageviews: 0, bounce_rate: 0, visit_duration: 0 },
    // The day of the site in Plausible (its time zone).
    day: '2026-10-15',
    // Visits of the window asked by "no visit for N hours".
    recentVisits: 5,
    topPath: null,
    ...fields,
  };
}

export class FakePlausible {
  constructor({ sites } = {}) {
    this.sites = sites ?? [
      site('blog.example.org', {
        active: 2,
        today: { visitors: 12, visits: 15, pageviews: 41, bounce_rate: 40, visit_duration: 75 },
        topPath: '/posts/hello',
      }),
      site('shop.example.org'),
    ];
    /** 'down': the server does not answer; a number: that HTTP status. */
    this.failure = null;
    this.requests = [];
    this.request = this.request.bind(this);
  }

  get(domain) {
    return this.sites.find((item) => item.domain === domain);
  }

  set(domain, fields) {
    Object.assign(this.get(domain), fields);
  }

  setToday(domain, fields) {
    Object.assign(this.get(domain).today, fields);
  }

  async request(url, { method = 'GET', headers = {}, body } = {}) {
    const parsed = new URL(url);
    const payload = body ? JSON.parse(body) : null;
    this.requests.push({ url, method, path: parsed.pathname, body: payload });
    if (this.failure === 'down') {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    if (typeof this.failure === 'number') {
      return { status: this.failure, body: '{}' };
    }
    const json = (status, data) => ({ status, body: JSON.stringify(data) });
    const realtime = parsed.pathname === '/api/v1/stats/realtime/visitors' && method === 'GET';
    const query = parsed.pathname === '/api/v2/query' && method === 'POST';
    if (!realtime && !query) {
      return { status: 404, body: '<!DOCTYPE html><html>Not found</html>' };
    }
    const domain = realtime ? parsed.searchParams.get('site_id') : payload?.site_id;
    const found = this.get(domain);
    if (headers.authorization !== `Bearer ${API_KEY}` || !found) {
      return { status: 401, body: REFUSED };
    }
    if (realtime) {
      return json(200, found.active);
    }
    const range =
      payload.date_range === 'day'
        ? [`${found.day}T00:00:00+02:00`, `${found.day}T23:59:59+02:00`]
        : payload.date_range;
    const answer = (results) =>
      json(200, { results, meta: {}, query: { ...payload, date_range: range } });
    if (payload.dimensions?.[0] === 'event:page') {
      return answer(found.topPath ? [{ metrics: [9], dimensions: [found.topPath] }] : []);
    }
    if (payload.date_range === 'day') {
      return answer([
        { metrics: payload.metrics.map((metric) => found.today[metric] ?? 0), dimensions: [] },
      ]);
    }
    // The window of the silence check.
    return answer([{ metrics: [found.recentVisits], dimensions: [] }]);
  }
}
