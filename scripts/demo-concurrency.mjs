#!/usr/bin/env node
// Headline demo (spec section 8): N parallel bookings race for the LAST unit
// of a room type. Exactly one must win; the rest get 409 ROOM_UNAVAILABLE and
// `booked` must end at the number of units, never above.
//
//   npm run demo:concurrency [-- --requests 50 --units 1 --nights 3]
//
// Runs against the live stack through the public API only (no DB access).
// Env: API_URL (default http://localhost:3000), API_KEY (default: the
// docker-compose placeholder). The key is never printed.
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    requests: { type: 'string', default: '50' },
    units: { type: 'string', default: '1' },
    nights: { type: 'string', default: '3' },
  },
});

const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
const apiKey = process.env.API_KEY ?? 'local-dev-api-key-change-me';
const requests = positiveInt('requests', args.requests);
const units = positiveInt('units', args.units);
const nights = positiveInt('nights', args.nights);

const checkIn = '2026-12-24';
const checkOut = addDays(checkIn, nights);
const headers = { 'content-type': 'application/json', 'x-api-key': apiKey };

// A fresh room type per run, so the demo is repeatable on the same database.
const runId = randomUUID().slice(0, 8);
const roomType = await call('POST', '/room-types', {
  name: `Demo last room ${runId}`,
  totalUnits: units,
  seedFrom: checkIn,
  seedTo: checkOut,
});

console.log(
  `\n${requests} parallel POST /reservations for ${units} unit(s), ` +
    `${nights} night(s) ${checkIn} -> ${checkOut} (room type ${roomType.id})\n`,
);

const started = performance.now();
const results = await Promise.all(
  Array.from({ length: requests }, (_, i) =>
    fetch(`${apiUrl}/reservations`, {
      method: 'POST',
      headers: { ...headers, 'x-request-id': `demo-${runId}-${i}` },
      body: JSON.stringify({
        roomTypeId: roomType.id,
        checkIn,
        checkOut,
        guest: { name: `Racer ${i}`, email: `racer${i}@example.com` },
      }),
    }).then(async (res) => {
      const body = await res.json();
      return res.status === 201
        ? `${res.status} Created`
        : `${res.status} ${body.error?.code ?? 'UNKNOWN'}`;
    }),
  ),
);
const elapsedMs = Math.round(performance.now() - started);

const tally = {};
for (const r of results) tally[r] = (tally[r] ?? 0) + 1;
console.table(
  Object.entries(tally).map(([outcome, count]) => ({ outcome, count })),
);

const availability = await call(
  'GET',
  `/availability?roomTypeId=${roomType.id}&from=${checkIn}&to=${checkOut}`,
);
console.table(
  availability.nights.map(({ date, total, booked, available }) => ({
    date,
    total,
    booked,
    available,
  })),
);

const winners = tally['201 Created'] ?? 0;
const overbooked = availability.nights.some((n) => n.booked > n.total);
const consistent = availability.nights.every((n) => n.booked === winners);
const ok = winners === Math.min(units, requests) && !overbooked && consistent;
console.log(
  `${ok ? 'PASS' : 'FAIL'}: ${winners} booking(s) succeeded for ${units} unit(s), ` +
    `booked = ${[...new Set(availability.nights.map((n) => n.booked))].join('/')} ` +
    `on every night, ${elapsedMs} ms for ${requests} requests\n`,
);
process.exit(ok ? 0 : 1);

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`${apiUrl}${path}`, {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) }),
    });
  } catch (err) {
    fail(
      `cannot reach ${apiUrl} (${err.cause?.code ?? err.message}). Is the stack up? docker compose up -d`,
    );
  }
  const json = await res.json();
  if (!res.ok)
    fail(
      `${method} ${path} -> ${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? ''}`,
    );
  return json;
}

function addDays(night, days) {
  const d = new Date(`${night}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function positiveInt(name, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    fail(`--${name} must be a positive integer`);
  return n;
}

function fail(message) {
  console.error(`demo:concurrency: ${message}`);
  process.exit(1);
}
