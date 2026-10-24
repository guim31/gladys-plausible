// -----------------------------------------------------------------------------
// A request function answering from the real exchanges recorded on Plausible
// CE 3.2.1 (test/fixtures/plausible): the visitors right now, the day, the top
// page and the window of a site; a 401 for anything else, like Plausible.
// -----------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';

export const FIXTURE = JSON.parse(
  await readFile(new URL('../fixtures/plausible/ce-3.2.1.json', import.meta.url), 'utf8'),
);

const REFUSED = FIXTURE.exchanges.find((exchange) => exchange.status === 401).answer;

/** What a request asks: realtime, day, top or window, and for which site. */
export function describe(path, request) {
  if (path.startsWith('/api/v1/stats/realtime/visitors')) {
    return { kind: 'realtime', site: new URL(path, 'http://x').searchParams.get('site_id') };
  }
  const kind = request.dimensions ? 'top' : request.date_range === 'day' ? 'day' : 'window';
  return { kind, site: request.site_id };
}

export function replay(fixture = FIXTURE) {
  const answers = new Map();
  for (const exchange of fixture.exchanges.filter((item) => item.status === 200)) {
    const { kind, site } = describe(exchange.path, exchange.request);
    answers.set(`${kind} ${site}`, exchange.answer);
  }
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, ...options });
    const { pathname, search } = new URL(url);
    const { kind, site } = describe(
      `${pathname}${search}`,
      options.body ? JSON.parse(options.body) : {},
    );
    const answer = answers.get(`${kind} ${site}`);
    return answer === undefined ? { status: 401, body: REFUSED } : { status: 200, body: answer };
  };
  return { request, calls };
}
