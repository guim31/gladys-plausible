# Plausible Analytics for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the figures of your [Plausible Analytics](https://plausible.io/)
sites — on plausible.io or on your own Community Edition server — into Gladys.

- **One device per site**: visitors right now (last 5 minutes), and the
  visitors, visits, page views, bounce rate, visit duration and most viewed
  page of the day.
- **Scene triggers**: visitor spike (above a threshold of your choice), first
  visitor of the day, no visit for N hours (a broken tracking script) — for
  any site, added to Gladys or not.
- **Scene action**: read the figures of a site, with a ready-made sentence for
  a message.
- **Dashboard widget**: the day at a glance, per site.
- Texts in English, French, German and Spanish.

Tested against a real self-hosted Plausible Community Edition 3.2.1 (Docker,
PostgreSQL and ClickHouse), with test sites fed through its event API.
Developed without a plausible.io account (same Stats API): feedback welcome on
[the issues](https://github.com/guim31/gladys-plausible/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- plausible.io, or a self-hosted Plausible Community Edition 2.1 or later
  (the Stats API v2).
- A **Stats API** key, and the domains of the sites to follow (a Stats API key
  cannot list its sites).

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-plausible`. Then open its configuration:
leave the address empty for plausible.io or enter the address of your server,
paste the Stats API key, type the domains of your sites, and add the sites
from the Discover tab.

The full guide: [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

At the chosen interval (one minute by default), the container reads the
visitors right now of every site (`GET /api/v1/stats/realtime/visitors`, the
Stats API v2 has no realtime range). Every 15 minutes, and at once when a
first visitor shows up, it reads the figures of the day and the most viewed
page (`POST /api/v2/query`, `date_range: "day"`, in the time zone of the site);
every 15 minutes when nobody is on a site, the visits of the last N hours. On
plausible.io (600 requests per hour and key) the interval is stretched to stay
under 540 requests per hour. It publishes the states of the devices added to
Gladys when they change and fires the scene events on transitions. What the
triggers remember is kept in `/data`, so a restart announces nothing twice.
Redirects are not followed, so the key is never sent to another host.

## Limits

- Read-only, one Plausible account per configuration, 25 sites at most.
- The domains are typed by hand (no Sites API in the Community Edition).
- The spike and silence thresholds are the same for every site.
- Plausible CE before 2.1 (no Stats API v2) is not supported. A self-signed
  HTTPS certificate is not accepted (use `http://` on the local network).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the
Plausible API.

## Credits

- [Plausible Analytics](https://github.com/plausible/analytics) by Plausible
  Insights OÜ and contributors (AGPL-3.0): the API answers in
  `test/fixtures/plausible` come from its Community Edition Docker image, and
  the logo of the cover from its repository (`priv/static/images/ee/logo_dark.svg`).
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-umami](https://github.com/guim31/gladys-umami).

Not affiliated with Plausible Insights OÜ.

## License

Apache-2.0, see [LICENSE](LICENSE).
