import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { Inventory } from '../src/inventory/inventory.schema.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { createRedisClient } from '../src/redis/redis.module.js';
import { Reservation } from '../src/reservations/reservation.schema.js';
import {
  API_KEY,
  bookingEvent,
  clearDatabase,
  createTestApp,
  DEAD_REDIS_URL,
  deliverWebhook,
  race,
  stay,
  tally,
} from './helpers.js';

/**
 * Redis down (connection refused): no lock, no idempotency cache.
 * Bookings must still be correct: MongoDB alone is the guarantee.
 */
describe('Redis down: bookings stay correct', () => {
  let app: INestApplication<App>;
  let baseUrl: string;
  let inventory: Model<Inventory>;
  let reservations: Model<Reservation>;
  const api = () => request(app.getHttpServer());

  async function createRoomType(totalUnits: number) {
    const res = await api()
      .post('/room-types')
      .set('X-Api-Key', API_KEY)
      .send({
        name: `RT ${totalUnits}`,
        totalUnits,
        seedFrom: '2026-12-24',
        seedTo: '2026-12-31',
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  beforeAll(async () => {
    app = await createTestApp((b) =>
      b
        .overrideProvider(REDIS_CLIENT)
        .useFactory({ factory: () => createRedisClient(DEAD_REDIS_URL) }),
    );
    await app.listen(0);
    baseUrl = await app.getUrl();
    inventory = app.get(getModelToken(Inventory.name));
    reservations = app.get(getModelToken(Reservation.name));
  });

  beforeEach(async () => {
    await clearDatabase(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('health reports Redis down as degraded (200), not an outage', async () => {
    const res = await api().get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'degraded' });
  });

  it('book and cancel work without Redis', async () => {
    const rt = await createRoomType(1);
    const created = await api()
      .post('/reservations')
      .set('X-Api-Key', API_KEY)
      .send(stay(rt))
      .expect(201);
    await api()
      .post(`/reservations/${(created.body as { id: string }).id}/cancel`)
      .set('X-Api-Key', API_KEY)
      .expect(200);
  });

  it('50 parallel requests for the last unit with NO lock: still exactly 1 succeeds', async () => {
    const rt = await createRoomType(1);
    const results = await race(
      baseUrl,
      Array.from({ length: 50 }, () =>
        stay(rt, { checkIn: '2026-12-24', checkOut: '2026-12-27' }),
      ),
    );
    console.log('50 requests, 1 unit, Redis DOWN:', tally(results));
    expect(tally(results)).toEqual({ '201': 1, '409 ROOM_UNAVAILABLE': 49 });
    const booked = await inventory
      .find({ roomTypeId: new Types.ObjectId(rt), date: { $lt: '2026-12-27' } })
      .lean();
    expect(booked.map((r) => r.booked)).toEqual([1, 1, 1]);
    expect(await reservations.countDocuments()).toBe(1);
  });

  it('Idempotency-Key still books once (falls back to the MongoDB record)', async () => {
    const rt = await createRoomType(5);
    const results = await race(
      baseUrl,
      Array.from({ length: 5 }, () => stay(rt)),
      { 'idempotency-key': 'redis-down-key' },
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await reservations.countDocuments()).toBe(1);
  });

  it('webhook: the same event 5 times in parallel still yields one reservation', async () => {
    const rt = await createRoomType(5);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        deliverWebhook(baseUrl, bookingEvent('evt_redis_down', rt)),
      ),
    );
    expect(results.filter((r) => r.outcome === 'processed')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'duplicate')).toHaveLength(4);
    expect(await reservations.countDocuments()).toBe(1);
  });
});
