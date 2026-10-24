// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Plausible, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read Plausible with
// `world.hub.pollNow()`. (Adapted from guim31/gladys-umami.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { siteIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { API_KEY, BASE, FakePlausible, site } from './fakePlausible.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub and the tests: 15/10/2026, 10:00 local. */
export function createClock(start = new Date(2026, 9, 15, 10, 0, 0).getTime()) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export async function createWorld({
  clock = createClock(),
  plausible = new FakePlausible(),
  config = {
    url: BASE,
    api_key: API_KEY,
    sites: 'blog.example.org, shop.example.org',
    language: 'en',
  },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-plausible-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: plausible.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, plausible, app, hub: app.hub, clock, dataDir };
}

/** External ids of the device of a site, by domain. */
export const idsOf = (world, domain) => siteIds(world.gladys, domain);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { API_KEY, BASE, FakePlausible, site };
