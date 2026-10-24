// -----------------------------------------------------------------------------
// Plausible client: the Stats API of Plausible Analytics, read-only, on
// plausible.io or a self-hosted Community Edition (2.1 and later, the first
// with the Stats API v2). Checked against a real Plausible CE 3.2.1 in Docker
// (test/fixtures/plausible).
//
//   GET  /api/v1/stats/realtime/visitors?site_id=D   visitors of the last 5
//                                                    minutes (v2 has no
//                                                    realtime range)
//   POST /api/v2/query                               today's visitors, visits,
//                                                    page views, bounce rate
//                                                    and visit duration; the
//                                                    most viewed page; the
//                                                    visits of the last N hours
//
// One key ("Stats API" key, `Authorization: Bearer`) per account. A key cannot
// list its sites (the Sites API is not in the Community Edition, and an
// Enterprise feature on plausible.io): the user types the domains.
//
// Plausible answers 401 with the same message for a wrong key and for a site
// the key cannot read: the hub tells them apart (every site refused, or some).
//
// Redirects are not followed: the key would be sent wherever the address
// points (an http:// address redirected to https:// is reported).
// -----------------------------------------------------------------------------

export const CLOUD_URL = 'https://plausible.io';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // key refused, or the site is not readable with it
  RATE_LIMIT: 'rate_limit', // HTTP 429 (600 requests per hour on plausible.io)
  NOT_PLAUSIBLE: 'not_plausible', // something answers, not the Stats API v2
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  HTTP: 'http', // any other HTTP error
});

export class PlausibleError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'PlausibleError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export const MAX_BODY_BYTES = 2 * 1024 * 1024;

// The metrics of the day, in this order in the answer of /api/v2/query.
export const DAY_METRICS = ['visitors', 'visits', 'pageviews', 'bounce_rate', 'visit_duration'];

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory Plausible
 * (test/helpers/fakePlausible.js).
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function httpRequest(
  url,
  { method = 'GET', headers = {}, body, timeoutMs = 15_000 } = {},
) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  return { status: response.status, body: await response.text() };
}

/** A count of the API: a non-negative integer, 0 when unusable. */
export function count(raw) {
  const number = typeof raw === 'string' ? Number(raw) : raw;
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function parse(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** The day of a v2 answer, `YYYY-MM-DD`, from its resolved date range (the site's time zone). */
export function dayOf(data) {
  const start = data?.query?.date_range?.[0];
  return typeof start === 'string' && /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : null;
}

export class PlausibleClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, '' for plausible.io
   * @param {string} options.apiKey "Stats API" key
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, apiKey, request, timeoutMs = 15_000 }) {
    this.cloud = !url;
    this.base = this.cloud ? CLOUD_URL : url;
    this.apiKey = apiKey;
    this.request = request ?? httpRequest;
    this.timeoutMs = timeoutMs;
    /** Times of the requests of the last hour (plausible.io rate limit). */
    this.sent = [];
  }

  /** Requests sent during the last hour. */
  sentLastHour(now = Date.now()) {
    this.sent = this.sent.filter((time) => now - time < 3600_000);
    return this.sent.length;
  }

  async send(path, { method = 'GET', body } = {}) {
    this.sent.push(Date.now());
    const headers = { accept: 'application/json', authorization: `Bearer ${this.apiKey}` };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    let response;
    try {
      response = await this.request(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new PlausibleError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      throw new PlausibleError(ERROR_KINDS.UNREACHABLE, code ?? err.name ?? err.message);
    }
    this.check(response);
    const data = parse(response.body);
    if (data === null) {
      throw new PlausibleError(ERROR_KINDS.NOT_PLAUSIBLE, 'The answer is not JSON');
    }
    return data;
  }

  check({ status, body }) {
    if (status === 401 || status === 403) {
      throw new PlausibleError(ERROR_KINDS.AUTH, `Key or site refused (HTTP ${status})`, {
        status,
      });
    }
    if (status === 429) {
      throw new PlausibleError(ERROR_KINDS.RATE_LIMIT, 'Too many requests (HTTP 429)', { status });
    }
    if (status >= 300 && status < 400) {
      throw new PlausibleError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new PlausibleError(
        ERROR_KINDS.NOT_PLAUSIBLE,
        'No Plausible Stats API at this address (HTTP 404)',
        { status },
      );
    }
    if (status < 200 || status >= 300) {
      // Plausible explains a 400 in `error` (no secret in it): worth a log line.
      const reason = parse(body)?.error;
      const detail = typeof reason === 'string' ? `: ${reason.slice(0, 200)}` : '';
      throw new PlausibleError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})${detail}`, {
        status,
      });
    }
  }

  query(site, body) {
    return this.send('/api/v2/query', { method: 'POST', body: { site_id: site, ...body } });
  }

  /** Visitors of the last 5 minutes. */
  async realtime(site) {
    const data = await this.send(
      `/api/v1/stats/realtime/visitors?site_id=${encodeURIComponent(site)}`,
    );
    if (typeof data !== 'number') {
      throw new PlausibleError(ERROR_KINDS.NOT_PLAUSIBLE, 'The answer is not a visitor count');
    }
    return count(data);
  }

  /**
   * Today's figures, "today" in the time zone of the site in Plausible.
   * @returns {Promise<{ day: string|null, visitors: number, visits: number, pageviews: number, bounceRate: number, visitDuration: number }>}
   */
  async today(site) {
    const data = await this.query(site, { metrics: DAY_METRICS, date_range: 'day' });
    const metrics = data?.results?.[0]?.metrics;
    if (!Array.isArray(metrics) || metrics.length !== DAY_METRICS.length) {
      throw new PlausibleError(ERROR_KINDS.NOT_PLAUSIBLE, 'The answer is not Plausible statistics');
    }
    const [visitors, visits, pageviews, bounceRate, visitDuration] = metrics.map(count);
    return {
      day: dayOf(data),
      visitors,
      visits,
      pageviews,
      bounceRate: Math.min(100, bounceRate),
      visitDuration,
    };
  }

  /**
   * Today's most viewed page, null when none.
   * @returns {Promise<{ path: string, views: number }|null>}
   */
  async topPage(site) {
    const data = await this.query(site, {
      metrics: ['pageviews'],
      date_range: 'day',
      dimensions: ['event:page'],
      order_by: [['pageviews', 'desc']],
      pagination: { limit: 1 },
    });
    if (!Array.isArray(data?.results)) {
      throw new PlausibleError(
        ERROR_KINDS.NOT_PLAUSIBLE,
        'The answer is not a Plausible breakdown',
      );
    }
    const top = data.results.find(
      (row) => typeof row?.dimensions?.[0] === 'string' && row.dimensions[0],
    );
    return top ? { path: top.dimensions[0], views: count(top.metrics?.[0]) } : null;
  }

  /** Visits between two times (milliseconds). */
  async visits(site, from, to) {
    const data = await this.query(site, {
      metrics: ['visits'],
      date_range: [new Date(from).toISOString(), new Date(to).toISOString()],
    });
    const metrics = data?.results?.[0]?.metrics;
    if (!Array.isArray(metrics)) {
      throw new PlausibleError(ERROR_KINDS.NOT_PLAUSIBLE, 'The answer is not Plausible statistics');
    }
    return count(metrics[0]);
  }
}
