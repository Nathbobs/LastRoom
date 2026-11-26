import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { signBody } from '../src/channels/channel-signature.guard.js';
import {
  API_KEY,
  bookingEvent,
  CHANNEL_SECRETS,
  clearDatabase,
  createTestApp,
  stay,
} from './helpers.js';
import { LogCapture, LogLine } from './log-capture.js';

/**
 * Phase 6 "done when": a single booking can be traced end-to-end by requestId.
 * Runs the production logger config at debug level, captured in memory.
 */
describe('Structured logs (integration)', () => {
  const logs = new LogCapture('debug');
  let app: INestApplication<App>;

  const api = () => request(app.getHttpServer());
  const post = (url: string) => api().post(url).set('X-Api-Key', API_KEY);

  async function createRoomType(totalUnits = 1): Promise<string> {
    const res = await post('/room-types')
      .send({
        name: 'Deluxe Double',
        totalUnits,
        seedFrom: '2026-12-24',
        seedTo: '2026-12-31',
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  /** Signs and sends a webhook through supertest (raw body preserved). */
  function webhook(body: object, requestId: string, channel = 'channel-a') {
    const raw = JSON.stringify(body);
    return api()
      .post(`/webhooks/channels/${channel}`)
      .set('Content-Type', 'application/json')
      .set('X-Request-Id', requestId)
      .set('X-Signature', signBody(CHANNEL_SECRETS[channel], raw))
      .send(raw);
  }

  const completed = (requestId: string) => (l: LogLine) =>
    l.requestId === requestId && l.msg === 'request completed';

  beforeAll(async () => {
    app = await createTestApp(logs.override);
  });

  beforeEach(async () => {
    await clearDatabase(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('traces one booking end-to-end by requestId', async () => {
    const roomTypeId = await createRoomType();
    const requestId = 'trace-booking-001';

    const res = await post('/reservations')
      .set('X-Request-Id', requestId)
      .send(stay(roomTypeId))
      .expect(201);
    const reservationId = (res.body as { id: string }).id;
    expect(res.headers['x-request-id']).toBe(requestId);

    const done = await logs.waitFor(completed(requestId));
    const trace = logs.forRequest(requestId);

    // The service line: domain fields as real JSON keys, same requestId.
    const created = trace.find((l) => l.msg === 'reservation created');
    expect(created).toMatchObject({
      level: 30,
      requestId,
      context: 'ReservationsService',
      reservationId,
      roomTypeId,
      source: 'direct',
      nights: 2,
      lock: 'acquired',
      guestEmail: 'a***@example.com',
    });
    expect(created?.durationMs).toEqual(expect.any(Number));

    // The access line: method, url, status and duration, nothing else.
    expect(done).toMatchObject({
      level: 30,
      requestId,
      req: { method: 'POST', url: '/reservations' },
      res: { statusCode: 201 },
    });
    expect(done.durationMs).toEqual(expect.any(Number));
    expect(Object.keys(done.req as object)).toEqual(['method', 'url']);

    // Order: the service line is written before the request completes.
    expect(trace.indexOf(created!)).toBeLessThan(trace.indexOf(done));
    // Every line is valid JSON with an ISO timestamp.
    for (const line of trace) {
      expect(new Date(line.time).toISOString()).toBe(line.time);
    }
  });

  it('generates a requestId when none is sent and uses it in the logs', async () => {
    const roomTypeId = await createRoomType();
    const res = await post('/reservations').send(stay(roomTypeId)).expect(201);
    const requestId = res.headers['x-request-id'] as string;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

    await logs.waitFor(completed(requestId));
    expect(logs.forRequest(requestId).map((l) => l.msg)).toEqual(
      expect.arrayContaining(['reservation created', 'request completed']),
    );
  });

  it('traces a rejected booking: booking rejected + 409 in the same trace', async () => {
    const roomTypeId = await createRoomType(1);
    await post('/reservations').send(stay(roomTypeId)).expect(201);

    const requestId = 'trace-rejected-001';
    await post('/reservations')
      .set('X-Request-Id', requestId)
      .send(stay(roomTypeId, { guest: { name: 'B', email: 'b@example.com' } }))
      .expect(409);

    const done = await logs.waitFor(completed(requestId));
    expect(done.res).toEqual({ statusCode: 409 });
    expect(done.level).toBe(30); // 4xx is info, not an error
    expect(
      logs.forRequest(requestId).find((l) => l.msg === 'booking rejected'),
    ).toMatchObject({
      code: 'ROOM_UNAVAILABLE',
      roomTypeId,
      source: 'direct',
      night: '2026-12-24',
    });
  });

  it('never logs the API key, HMAC secret, signature, idempotency key or full guest email', async () => {
    const roomTypeId = await createRoomType(3);
    const email = 'very.private.guest@example.com';
    // Unique per run: the Redis cache keeps keys for 24h across test runs.
    const idempotencyKey = `idem-key-not-logged-${randomUUID()}`;

    await post('/reservations')
      .set('X-Request-Id', 'trace-secrets-api')
      .set('Idempotency-Key', idempotencyKey)
      .send(stay(roomTypeId, { guest: { name: 'Private Guest', email } }))
      .expect(201);
    // A replay logs too: it must not leak the key either.
    await post('/reservations')
      .set('Idempotency-Key', idempotencyKey)
      .send(stay(roomTypeId, { guest: { name: 'Private Guest', email } }))
      .expect(201);

    const event = bookingEvent('evt_secrets', roomTypeId, {
      guest: { name: 'Channel Guest', email: 'channel.only.guest@example.com' },
    });
    const signature = signBody(
      CHANNEL_SECRETS['channel-a'],
      JSON.stringify(event),
    );
    await webhook(event, 'trace-secrets-webhook').expect(200);
    // A bad signature is logged as a failed request: still no secret in it.
    await api()
      .post('/webhooks/channels/channel-a')
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'sha256=' + '0'.repeat(64))
      .send(JSON.stringify(event))
      .expect(401);

    await logs.waitFor(completed('trace-secrets-webhook'));
    const text = logs.text();
    expect(text.length).toBeGreaterThan(0);
    for (const secret of [
      API_KEY,
      CHANNEL_SECRETS['channel-a'],
      signature,
      idempotencyKey,
      email,
      'very.private.guest',
      'channel.only.guest',
    ]) {
      expect(text).not.toContain(secret);
    }
    // The masked form is what support gets instead.
    expect(text).toContain('v***@example.com');
  });
});
