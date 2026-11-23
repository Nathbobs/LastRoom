import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Redis } from 'ioredis';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { Inventory } from '../src/inventory/inventory.schema.js';
import { redisKey } from '../src/redis/idempotency-cache.service.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { Reservation } from '../src/reservations/reservation.schema.js';
import { API_KEY, clearDatabase, createTestApp, stay } from './helpers.js';

/**
 * Phase 3: create/cancel against REAL Mongo (replica set) and Redis.
 * The 50-way race lives in test/reservations.conc-spec.ts.
 */
describe('Phase 3 reservations (integration)', () => {
  let app: INestApplication<App>;
  let inventory: Model<Inventory>;
  let reservations: Model<Reservation>;
  let redis: Redis;

  const api = () => request(app.getHttpServer());
  const post = (url: string) => api().post(url).set('X-Api-Key', API_KEY);
  const put = (url: string) => api().put(url).set('X-Api-Key', API_KEY);

  async function createRoomType(totalUnits = 1, name = 'Deluxe Double') {
    const res = await post('/room-types')
      .send({ name, totalUnits, seedFrom: '2026-12-24', seedTo: '2026-12-31' })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function bookedByNight(roomTypeId: string) {
    const rows = await inventory
      .find({ roomTypeId: new Types.ObjectId(roomTypeId) })
      .sort({ date: 1 })
      .lean();
    return Object.fromEntries(rows.map((r) => [r.date, r.booked]));
  }

  function errorCode(body: unknown): string {
    return (body as { error: { code: string } }).error.code;
  }

  beforeAll(async () => {
    app = await createTestApp();
    inventory = app.get(getModelToken(Inventory.name));
    reservations = app.get(getModelToken(Reservation.name));
    redis = app.get(REDIS_CLIENT);
  });

  beforeEach(async () => {
    await clearDatabase(app);
    const keys = await redis.keys('idem:reservations:test-*');
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('POST /reservations', () => {
    it('books every night of [checkIn, checkOut); the check-out day stays free', async () => {
      const rt = await createRoomType(2);
      const res = await post('/reservations')
        .send(stay(rt, { checkIn: '2026-12-24', checkOut: '2026-12-27' }))
        .expect(201);

      expect(res.body).toMatchObject({
        roomTypeId: rt,
        checkIn: '2026-12-24',
        checkOut: '2026-12-27',
        nights: ['2026-12-24', '2026-12-25', '2026-12-26'],
        status: 'CONFIRMED',
        source: 'direct',
        guest: { name: 'Ada Lovelace', email: 'ada@example.com' },
      });
      expect(res.body).not.toHaveProperty('idempotencyKey');
      expect(await bookedByNight(rt)).toMatchObject({
        '2026-12-24': 1,
        '2026-12-25': 1,
        '2026-12-26': 1,
        '2026-12-27': 0, // check-out day
      });
    });

    it('back-to-back stays share no night: check-out day can be re-sold', async () => {
      const rt = await createRoomType(1);
      await post('/reservations')
        .send(stay(rt, { checkIn: '2026-12-24', checkOut: '2026-12-26' }))
        .expect(201);
      await post('/reservations')
        .send(stay(rt, { checkIn: '2026-12-26', checkOut: '2026-12-28' }))
        .expect(201);
    });

    it('409 ROOM_UNAVAILABLE when the night is full', async () => {
      const rt = await createRoomType(1);
      await post('/reservations').send(stay(rt)).expect(201);
      const res = await post('/reservations').send(stay(rt)).expect(409);
      expect(errorCode(res.body)).toBe('ROOM_UNAVAILABLE');
      expect(res.body.error.details).toEqual({
        roomTypeId: rt,
        night: '2026-12-24',
      });
    });

    it('partial failure: one full night in the middle leaves NO night claimed', async () => {
      const rt = await createRoomType(1);
      // Fill only the 26th.
      await post('/reservations')
        .send(stay(rt, { checkIn: '2026-12-26', checkOut: '2026-12-27' }))
        .expect(201);
      const before = await bookedByNight(rt);

      // 24, 25 are claimed first, then 26 is full -> whole transaction aborts.
      const res = await post('/reservations')
        .send(stay(rt, { checkIn: '2026-12-24', checkOut: '2026-12-29' }))
        .expect(409);
      expect(res.body.error.details).toMatchObject({ night: '2026-12-26' });

      expect(await bookedByNight(rt)).toEqual(before);
      expect(before).toMatchObject({
        '2026-12-24': 0,
        '2026-12-25': 0,
        '2026-12-26': 1,
        '2026-12-27': 0,
        '2026-12-28': 0,
      });
      expect(await reservations.countDocuments()).toBe(1);
    });

    it('a night with no inventory row is not sellable (409, nothing claimed)', async () => {
      const rt = await createRoomType(1); // seeded 24..30
      const res = await post('/reservations')
        .send(stay(rt, { checkIn: '2026-12-30', checkOut: '2027-01-02' }))
        .expect(409);
      expect(res.body.error.details).toMatchObject({ night: '2026-12-31' });
      expect((await bookedByNight(rt))['2026-12-30']).toBe(0);
    });

    it('a night with total lowered to 0 is not sellable', async () => {
      const rt = await createRoomType(1);
      await put(`/room-types/${rt}/inventory`)
        .send({ from: '2026-12-25', to: '2026-12-26', total: 0 })
        .expect(200);
      await post('/reservations').send(stay(rt)).expect(409);
    });

    it('404 for an unknown room type, 400 for bad stays', async () => {
      const unknown = await post('/reservations')
        .send(stay(new Types.ObjectId().toString()))
        .expect(404);
      expect(errorCode(unknown.body)).toBe('NOT_FOUND');

      const rt = await createRoomType(1);
      for (const bad of [
        { checkIn: '2026-12-26', checkOut: '2026-12-26' }, // zero nights
        { checkIn: '2026-12-27', checkOut: '2026-12-26' }, // reversed
        { checkIn: '2026-12-01', checkOut: '2027-01-01' }, // 31 nights
        { checkIn: '2026-02-30', checkOut: '2026-03-02' }, // not a real date
      ]) {
        const res = await post('/reservations').send(stay(rt, bad)).expect(400);
        expect(errorCode(res.body)).toBe('VALIDATION_ERROR');
      }

      const badEmail = await post('/reservations')
        .send(stay(rt, { guest: { name: 'Ada', email: 'nope' } }))
        .expect(400);
      expect(badEmail.body.error.details.fields).toEqual([
        { field: 'guest.email', errors: ['email must be an email'] },
      ]);
      expect(await reservations.countDocuments()).toBe(0);
    });
  });

  describe('POST /reservations/:id/cancel', () => {
    it('cancels, releases every night, and the nights can be sold again', async () => {
      const rt = await createRoomType(1);
      const created = await post('/reservations').send(stay(rt)).expect(201);
      const id = (created.body as { id: string }).id;

      const res = await post(`/reservations/${id}/cancel`).expect(200);
      expect(res.body).toMatchObject({ id, status: 'CANCELLED' });
      expect(res.body.cancelledAt).toEqual(expect.any(String));
      expect(await bookedByNight(rt)).toMatchObject({
        '2026-12-24': 0,
        '2026-12-25': 0,
      });

      await post('/reservations').send(stay(rt)).expect(201);
    });

    it('409 INVALID_STATE when already cancelled (released only once)', async () => {
      const rt = await createRoomType(2);
      await post('/reservations').send(stay(rt)).expect(201);
      const created = await post('/reservations').send(stay(rt)).expect(201);
      const id = (created.body as { id: string }).id;

      await post(`/reservations/${id}/cancel`).expect(200);
      const again = await post(`/reservations/${id}/cancel`).expect(409);
      expect(errorCode(again.body)).toBe('INVALID_STATE');
      expect((await bookedByNight(rt))['2026-12-24']).toBe(1);
    });

    it('404 for an unknown reservation, 400 for a malformed id', async () => {
      const res = await post(
        `/reservations/${new Types.ObjectId().toString()}/cancel`,
      ).expect(404);
      expect(errorCode(res.body)).toBe('NOT_FOUND');
      await post('/reservations/not-an-id/cancel').expect(400);
    });

    it('refuses to release when inventory has drifted (nothing changes)', async () => {
      const rt = await createRoomType(1);
      const created = await post('/reservations').send(stay(rt)).expect(201);
      const id = (created.body as { id: string }).id;
      // Simulate drift: someone zeroed one night behind the API's back.
      await inventory.updateOne(
        { roomTypeId: new Types.ObjectId(rt), date: '2026-12-25' },
        { $set: { booked: 0 } },
      );

      const res = await post(`/reservations/${id}/cancel`).expect(409);
      expect(errorCode(res.body)).toBe('INVALID_STATE');
      expect((await bookedByNight(rt))['2026-12-24']).toBe(1);
      expect((await reservations.findById(id))?.status).toBe('CONFIRMED');
    });
  });

  describe('Idempotency-Key (Layer C)', () => {
    it('a retry with the same key returns the original reservation and books once', async () => {
      const rt = await createRoomType(5);
      const first = await post('/reservations')
        .set('Idempotency-Key', 'test-key-1')
        .send(stay(rt))
        .expect(201);
      expect(first.headers['idempotent-replayed']).toBeUndefined();

      const retry = await post('/reservations')
        .set('Idempotency-Key', 'test-key-1')
        .send(stay(rt))
        .expect(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.body).toEqual(first.body);

      expect(await reservations.countDocuments()).toBe(1);
      expect((await bookedByNight(rt))['2026-12-24']).toBe(1);
      // Cached in Redis with a 24h TTL.
      const ttl = await redis.ttl(redisKey('reservations', 'test-key-1'));
      expect(ttl).toBeGreaterThan(24 * 60 * 60 - 60);
    });

    it('still books once when the Redis entry is gone (MongoDB is the durable record)', async () => {
      const rt = await createRoomType(5);
      const first = await post('/reservations')
        .set('Idempotency-Key', 'test-key-2')
        .send(stay(rt))
        .expect(201);
      await redis.del(redisKey('reservations', 'test-key-2'));

      const retry = await post('/reservations')
        .set('Idempotency-Key', 'test-key-2')
        .send(stay(rt))
        .expect(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect((retry.body as { id: string }).id).toBe(
        (first.body as { id: string }).id,
      );
      expect(await reservations.countDocuments()).toBe(1);
    });

    it('parallel retries with the same key create exactly one reservation', async () => {
      const rt = await createRoomType(5);
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          post('/reservations')
            .set('Idempotency-Key', 'test-key-3')
            .send(stay(rt)),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(
        new Set(results.map((r) => (r.body as { id: string }).id)).size,
      ).toBe(1);
      expect(await reservations.countDocuments()).toBe(1);
      expect((await bookedByNight(rt))['2026-12-24']).toBe(1);
    });

    it('409 when the same key is reused for a different request', async () => {
      const rt = await createRoomType(5);
      await post('/reservations')
        .set('Idempotency-Key', 'test-key-4')
        .send(stay(rt))
        .expect(201);
      const res = await post('/reservations')
        .set('Idempotency-Key', 'test-key-4')
        .send(stay(rt, { checkOut: '2026-12-27' }))
        .expect(409);
      expect(errorCode(res.body)).toBe('INVALID_STATE');
      expect(await reservations.countDocuments()).toBe(1);
    });

    it('a failed request is not remembered: the same key can succeed later', async () => {
      const rt = await createRoomType(1);
      await post('/reservations').send(stay(rt)).expect(201);
      await post('/reservations')
        .set('Idempotency-Key', 'test-key-5')
        .send(stay(rt))
        .expect(409);

      await put(`/room-types/${rt}/inventory`)
        .send({ from: '2026-12-24', to: '2026-12-26', total: 2 })
        .expect(200);
      const ok = await post('/reservations')
        .set('Idempotency-Key', 'test-key-5')
        .send(stay(rt))
        .expect(201);
      expect(ok.headers['idempotent-replayed']).toBeUndefined();
    });

    it('400 for a malformed key', async () => {
      const rt = await createRoomType(1);
      const res = await post('/reservations')
        .set('Idempotency-Key', 'has spaces in it')
        .send(stay(rt))
        .expect(400);
      expect(errorCode(res.body)).toBe('VALIDATION_ERROR');
      expect(await reservations.countDocuments()).toBe(0);
    });
  });
});
