#!/usr/bin/env node
// Mock channel: signs a booking event with the channel's HMAC secret and sends
// it to the webhook, optionally several times (to show replays are harmless).
//
//   npm run webhook:send -- --room-type <id> [--event evt_1] [--type created|cancelled]
//        [--external CHA-1] [--check-in 2026-12-24] [--check-out 2026-12-26]
//        [--channel channel-a] [--times 5] [--parallel]
//
// Env: API_URL (default http://localhost:3000), CHANNEL_SECRETS (same format as
// the API; defaults to the docker-compose placeholders). Secrets are never printed.
import { createHmac, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    'room-type': { type: 'string' },
    event: { type: 'string' },
    type: { type: 'string', default: 'created' },
    external: { type: 'string', default: 'CHA-1001' },
    'check-in': { type: 'string', default: '2026-12-24' },
    'check-out': { type: 'string', default: '2026-12-26' },
    channel: { type: 'string', default: 'channel-a' },
    times: { type: 'string', default: '1' },
    parallel: { type: 'boolean', default: false },
  },
});

const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
const secrets = Object.fromEntries(
  (
    process.env.CHANNEL_SECRETS ??
    'channel-a=local-dev-channel-a-secret,channel-b=local-dev-channel-b-secret'
  )
    .split(',')
    .map((entry) => {
      const eq = entry.indexOf('=');
      return [entry.slice(0, eq).trim(), entry.slice(eq + 1).trim()];
    }),
);

const secret = secrets[args.channel];
if (!secret) fail(`no secret configured for channel "${args.channel}"`);
const times = Number(args.times);
if (!Number.isInteger(times) || times < 1)
  fail('--times must be a positive integer');

let body;
if (args.type === 'created') {
  if (!args['room-type']) fail('--room-type <id> is required for created');
  body = {
    eventId: args.event ?? `evt_${randomUUID()}`,
    type: 'booking.created',
    data: {
      externalId: args.external,
      roomTypeId: args['room-type'],
      checkIn: args['check-in'],
      checkOut: args['check-out'],
      guest: { name: 'Mock Channel Guest', email: 'guest@example.com' },
    },
  };
} else if (args.type === 'cancelled') {
  body = {
    eventId: args.event ?? `evt_${randomUUID()}`,
    type: 'booking.cancelled',
    data: { externalId: args.external },
  };
} else {
  fail('--type must be created or cancelled');
}

const raw = JSON.stringify(body);
const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

// One X-Request-Id per delivery, so each one can be found in the API logs:
//   docker compose logs api | grep '"requestId":"<id>"'
// Kept within the API's accepted format ([A-Za-z0-9._-], max 64 chars).
const requestIdBase = body.eventId
  .replace(/[^A-Za-z0-9._-]/g, '_')
  .slice(0, 50);

async function send(i) {
  const requestId = `wh-${requestIdBase}-${i + 1}`;
  const res = await fetch(`${apiUrl}/webhooks/channels/${args.channel}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': signature,
      'x-request-id': requestId,
    },
    body: raw,
  });
  const json = await res.json();
  return {
    delivery: i + 1,
    requestId: res.headers.get('x-request-id') ?? requestId,
    http: res.status,
    status: json.status ?? '-',
    eventStatus: json.eventStatus ?? '-',
    reservationId: json.reservationId ?? '-',
    error: json.error?.code ?? '-',
  };
}

console.log(
  `${args.channel} -> ${apiUrl}  eventId=${body.eventId}  type=${body.type}  x${times}${args.parallel ? ' (parallel)' : ''}`,
);
const indexes = Array.from({ length: times }, (_, i) => i);
const rows = args.parallel
  ? await Promise.all(indexes.map(send))
  : await indexes.reduce(
      async (acc, i) => [...(await acc), await send(i)],
      Promise.resolve([]),
    );
console.table(rows);

function fail(message) {
  console.error(`send-webhook: ${message}`);
  process.exit(1);
}
