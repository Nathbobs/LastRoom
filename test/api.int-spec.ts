import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { Inventory } from '../src/inventory/inventory.schema.js';
import { Reservation } from '../src/reservations/reservation.schema.js';
import { API_KEY, clearDatabase, createTestApp } from './helpers.js';

/**
 * Phase 2 integration tests against REAL Mongo (replica set) and Redis.
 * Needs `docker compose up -d mongo redis` first.
 */
describe('Phase 2 API (integration)', () => {
  let app: INestApplication<App>;
  let inventory: Model<Inventory>;
  let reservations: Model<Reservation>;
  let connection: Connection;

  const api = () => request(app.getHttpServer());
  const authed = {
    get: (url: string) => api().get(url).set('X-Api-Key', API_KEY),
    post: (url: string) => api().post(url).set('X-Api-Key', API_KEY),
    put: (url: string) => api().put(url).set('X-Api-Key', API_KEY),
  };

  /** Asserts the spec error shape and returns the error payload. */
  function expectErrorShape(
    body: unknown,
    code: string,
  ): { message: string; details: Record<string, unknown>; requestId: string } {
    expect(body).toEqual({
      error: {
        code,
        message: expect.any(String) as string,
        details: expect.any(Object) as object,
        requestId: expect.any(String) as string,
      },
    });
    return (body as { error: never }).error;
  }

  async function createRoomType(body: Record<string, unknown> = {}) {
    const res = await authed
      .post('/room-types')
      .send({
        name: 'Deluxe Double',
        totalUnits: 5,
        seedFrom: '2026-12-24',
        seedTo: '2026-12-28',
        ...body,
      })
      .expect(201);
    return res.body as { id: string; seededNights: number };
  }

  function reservationDoc(overrides: Partial<Reservation> = {}) {
    return {
      roomTypeId: new Types.ObjectId(),
      checkIn: '2026-12-24',
      checkOut: '2026-12-26',
      nights: ['2026-12-24', '2026-12-25'],
      guest: { name: 'Ada', email: 'ada@example.com' },
      ...overrides,
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    inventory = app.get(getModelToken(Inventory.name));
    reservations = app.get(getModelToken(Reservation.name));
    connection = app.get(getConnectionToken());
  });

  beforeEach(async () => {
    await clearDatabase(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('API key, request id and error shape', () => {
    it('rejects a missing API key with 401 UNAUTHORIZED', async () => {
      const res = await api().get('/room-types').expect(401);
      expectErrorShape(res.body, 'UNAUTHORIZED');
    });

    it('rejects a wrong API key with 401 UNAUTHORIZED', async () => {
      const res = await api()
        .get('/room-types')
        .set('X-Api-Key', 'wrong-key-0123456789')
        .expect(401);
      expectErrorShape(res.body, 'UNAUTHORIZED');
    });

    it('leaves /health public', async () => {
      await api().get('/health').expect(200);
    });

    it('echoes a safe X-Request-Id in the header and the error body', async () => {
      const res = await api()
        .get('/room-types')
        .set('X-Request-Id', 'trace-abc-123')
        .expect(401);
      expect(res.headers['x-request-id']).toBe('trace-abc-123');
      expect(expectErrorShape(res.body, 'UNAUTHORIZED').requestId).toBe(
        'trace-abc-123',
      );
    });

    it('replaces an unsafe X-Request-Id with a generated one', async () => {
      const res = await api()
        .get('/health')
        .set('X-Request-Id', 'bad id with spaces <script>');
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('unknown route -> 404 NOT_FOUND in the spec shape', async () => {
      const res = await authed.get('/nope').expect(404);
      expectErrorShape(res.body, 'NOT_FOUND');
    });

    it('malformed JSON -> 400 VALIDATION_ERROR in the spec shape', async () => {
      const res = await authed
        .post('/room-types')
        .set('Content-Type', 'application/json')
        .send('{"name": ')
        .expect(400);
      expectErrorShape(res.body, 'VALIDATION_ERROR');
    });

    it('malformed id in the path -> 400 VALIDATION_ERROR', async () => {
      const res = await authed.get('/reservations/not-an-id').expect(400);
      expectErrorShape(res.body, 'VALIDATION_ERROR');
    });
  });

  describe('room types', () => {
    it('creates a room type and seeds one inventory row per night [seedFrom, seedTo)', async () => {
      const rt = await createRoomType();
      expect(rt.seededNights).toBe(4);

      const rows = await inventory
        .find({ roomTypeId: rt.id }, { _id: 0, date: 1, total: 1, booked: 1 })
        .sort({ date: 1 })
        .lean();
      expect(rows).toEqual([
        { date: '2026-12-24', total: 5, booked: 0 },
        { date: '2026-12-25', total: 5, booked: 0 },
        { date: '2026-12-26', total: 5, booked: 0 },
        { date: '2026-12-27', total: 5, booked: 0 },
      ]);
    });

    it('lists room types', async () => {
      await createRoomType({ name: 'A' });
      await createRoomType({ name: 'B' });
      const res = await authed.get('/room-types').expect(200);
      expect((res.body as { name: string }[]).map((r) => r.name)).toEqual([
        'A',
        'B',
      ]);
    });

    it('rejects a duplicate name with 409 INVALID_STATE and seeds nothing extra', async () => {
      await createRoomType();
      const res = await authed
        .post('/room-types')
        .send({ name: 'Deluxe Double', totalUnits: 3 })
        .expect(409);
      expectErrorShape(res.body, 'INVALID_STATE');
      expect(await inventory.countDocuments()).toBe(4);
    });

    it('rejects seedFrom without seedTo', async () => {
      const res = await authed
        .post('/room-types')
        .send({ name: 'X', totalUnits: 1, seedFrom: '2026-12-24' })
        .expect(400);
      expectErrorShape(res.body, 'VALIDATION_ERROR');
    });

    it('rejects an invalid body with a per-field list', async () => {
      const res = await authed
        .post('/room-types')
        .send({ name: '', totalUnits: 0, seedFrom: '2026-02-30' })
        .expect(400);
      const err = expectErrorShape(res.body, 'VALIDATION_ERROR');
      const fields = (err.details.fields as { field: string }[]).map(
        (f) => f.field,
      );
      expect(fields).toEqual(['name', 'totalUnits', 'seedFrom']);
    });
  });

  describe('PUT /room-types/:id/inventory (invariant: total never below booked)', () => {
    it('sets total for every night and creates missing nights with booked 0', async () => {
      const rt = await createRoomType();
      await inventory.updateOne(
        { roomTypeId: rt.id, date: '2026-12-25' },
        { $set: { booked: 2 } },
      );

      const res = await authed
        .put(`/room-types/${rt.id}/inventory`)
        .send({ from: '2026-12-25', to: '2026-12-30', total: 3 })
        .expect(200);
      expect(res.body).toEqual({
        roomTypeId: rt.id,
        from: '2026-12-25',
        to: '2026-12-30',
        total: 3,
        nights: 5,
      });

      const rows = await inventory
        .find({ roomTypeId: rt.id }, { _id: 0, date: 1, total: 1, booked: 1 })
        .sort({ date: 1 })
        .lean();
      expect(rows).toEqual([
        { date: '2026-12-24', total: 5, booked: 0 }, // outside range: untouched
        { date: '2026-12-25', total: 3, booked: 2 }, // booked preserved
        { date: '2026-12-26', total: 3, booked: 0 },
        { date: '2026-12-27', total: 3, booked: 0 },
        { date: '2026-12-28', total: 3, booked: 0 }, // created
        { date: '2026-12-29', total: 3, booked: 0 }, // created
      ]);
    });

    it('rejects the WHOLE update (409, nothing changes) if any night has more booked than the new total', async () => {
      const rt = await createRoomType();
      await inventory.updateOne(
        { roomTypeId: rt.id, date: '2026-12-26' },
        { $set: { booked: 4 } },
      );

      const res = await authed
        .put(`/room-types/${rt.id}/inventory`)
        .send({ from: '2026-12-24', to: '2026-12-30', total: 3 })
        .expect(409);
      const err = expectErrorShape(res.body, 'INVALID_STATE');
      expect(err.details.blockedNights).toEqual([
        { date: '2026-12-26', booked: 4 },
      ]);

      // All-or-nothing: no totals changed and no rows were created.
      const rows = await inventory.find({ roomTypeId: rt.id }).lean();
      expect(rows).toHaveLength(4);
      expect(rows.every((r) => r.total === 5)).toBe(true);
    });

    it('404 for an unknown room type', async () => {
      const res = await authed
        .put(`/room-types/${new Types.ObjectId().toString()}/inventory`)
        .send({ from: '2026-12-24', to: '2026-12-25', total: 1 })
        .expect(404);
      expectErrorShape(res.body, 'NOT_FOUND');
    });

    it('400 when from is not before to', async () => {
      const rt = await createRoomType();
      const res = await authed
        .put(`/room-types/${rt.id}/inventory`)
        .send({ from: '2026-12-25', to: '2026-12-25', total: 1 })
        .expect(400);
      expectErrorShape(res.body, 'VALIDATION_ERROR');
    });
  });

  describe('collection validator (database-level backstop)', () => {
    it('MongoDB rejects any write that would make booked > total, even bypassing the app', async () => {
      const rt = await createRoomType({ totalUnits: 1 });
      const raw = connection.collection('inventory');
      const filter = {
        roomTypeId: new Types.ObjectId(rt.id),
        date: '2026-12-24',
      };

      await raw.updateOne(filter, { $inc: { booked: 1 } }); // 1 <= 1: allowed
      await expect(
        raw.updateOne(filter, { $inc: { booked: 1 } }), // 2 > 1: rejected
      ).rejects.toMatchObject({ code: 121 }); // DocumentValidationFailure
      await expect(
        raw.updateOne(filter, { $set: { booked: -1 } }),
      ).rejects.toMatchObject({ code: 121 });

      expect(await raw.findOne(filter)).toMatchObject({ total: 1, booked: 1 });
    });
  });

  describe('GET /availability', () => {
    it('returns every night in [from, to); nights with no row are total 0', async () => {
      const rt = await createRoomType();
      await inventory.updateOne(
        { roomTypeId: rt.id, date: '2026-12-25' },
        { $set: { booked: 2 } },
      );

      const res = await authed
        .get(`/availability?roomTypeId=${rt.id}&from=2026-12-26&to=2026-12-30`)
        .expect(200);
      expect(res.body).toEqual({
        roomTypeId: rt.id,
        from: '2026-12-26',
        to: '2026-12-30',
        nights: [
          { date: '2026-12-26', total: 5, booked: 0, available: 5 },
          { date: '2026-12-27', total: 5, booked: 0, available: 5 },
          { date: '2026-12-28', total: 0, booked: 0, available: 0 },
          { date: '2026-12-29', total: 0, booked: 0, available: 0 },
        ],
      });

      const booked = await authed
        .get(`/availability?roomTypeId=${rt.id}&from=2026-12-25&to=2026-12-26`)
        .expect(200);
      expect((booked.body as { nights: unknown[] }).nights).toEqual([
        { date: '2026-12-25', total: 5, booked: 2, available: 3 },
      ]);
    });

    it('validates the query and 404s an unknown room type', async () => {
      const bad = await authed
        .get('/availability?roomTypeId=nope&from=2026-12-24&to=2026-13-01')
        .expect(400);
      const err = expectErrorShape(bad.body, 'VALIDATION_ERROR');
      expect(
        (err.details.fields as { field: string }[]).map((f) => f.field),
      ).toEqual(['roomTypeId', 'to']);

      const missing = await authed
        .get(
          `/availability?roomTypeId=${new Types.ObjectId().toString()}&from=2026-12-24&to=2026-12-25`,
        )
        .expect(404);
      expectErrorShape(missing.body, 'NOT_FOUND');
    });
  });

  describe('reservation indexes', () => {
    it('two DIRECT reservations (no externalId) can both be saved (regression: partial, not sparse, index)', async () => {
      await reservations.create(reservationDoc());
      await reservations.create(reservationDoc());
      expect(await reservations.countDocuments({ source: 'direct' })).toBe(2);
    });

    it('the same channel booking (source, externalId) can only exist once', async () => {
      const doc = reservationDoc({ source: 'channel-a', externalId: 'CHA-1' });
      await reservations.create(doc);
      await expect(reservations.create(doc)).rejects.toMatchObject({
        code: 11000,
      });
      // ...but the same externalId from a different channel is a different booking.
      await reservations.create({ ...doc, source: 'channel-b' });
    });
  });

  describe('GET /reservations', () => {
    it('gets one reservation by id, 404 if unknown', async () => {
      const doc = await reservations.create(reservationDoc());
      const res = await authed
        .get(`/reservations/${doc._id.toString()}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id: doc._id.toString(),
        checkIn: '2026-12-24',
        checkOut: '2026-12-26',
        nights: ['2026-12-24', '2026-12-25'],
        status: 'CONFIRMED',
        source: 'direct',
      });

      const missing = await authed
        .get(`/reservations/${new Types.ObjectId().toString()}`)
        .expect(404);
      expectErrorShape(missing.body, 'NOT_FOUND');
    });

    it('filters by status and date overlap (check-out exclusive) and paginates newest first', async () => {
      const rtId = new Types.ObjectId();
      // Stay A: nights 24, 25. Stay B: nights 26, 27. Stay C: cancelled, nights 24-26.
      const a = await reservations.create(
        reservationDoc({
          roomTypeId: rtId,
          checkIn: '2026-12-24',
          checkOut: '2026-12-26',
        }),
      );
      const b = await reservations.create(
        reservationDoc({
          roomTypeId: rtId,
          checkIn: '2026-12-26',
          checkOut: '2026-12-28',
        }),
      );
      await reservations.create(
        reservationDoc({
          roomTypeId: rtId,
          checkIn: '2026-12-24',
          checkOut: '2026-12-27',
          status: 'CANCELLED',
        }),
      );

      const ids = (body: unknown) =>
        (body as { items: { id: string }[] }).items.map((i) => i.id);

      // Window [26, 27): A checks out on the 26th, so it has no night in it.
      const window = await authed
        .get(
          `/reservations?roomTypeId=${rtId.toString()}&status=CONFIRMED&from=2026-12-26&to=2026-12-27`,
        )
        .expect(200);
      expect(ids(window.body)).toEqual([b._id.toString()]);

      const page1 = await authed
        .get(`/reservations?status=CONFIRMED&limit=1&page=1`)
        .expect(200);
      expect(page1.body).toMatchObject({ page: 1, limit: 1, total: 2 });
      expect(ids(page1.body)).toEqual([b._id.toString()]); // newest first

      const page2 = await authed
        .get(`/reservations?status=CONFIRMED&limit=1&page=2`)
        .expect(200);
      expect(ids(page2.body)).toEqual([a._id.toString()]);
    });

    it('rejects bad list queries', async () => {
      const res = await authed
        .get('/reservations?status=PENDING&limit=500&page=0')
        .expect(400);
      const err = expectErrorShape(res.body, 'VALIDATION_ERROR');
      expect(
        (err.details.fields as { field: string }[]).map((f) => f.field),
      ).toEqual(['status', 'page', 'limit']);
    });
  });

  describe('Swagger', () => {
    it('/docs-json lists every endpoint and is public', async () => {
      const res = await api().get('/docs-json').expect(200);
      const paths = (res.body as { paths: Record<string, object> }).paths;
      const routes = Object.entries(paths)
        .flatMap(([path, ops]) =>
          Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`),
        )
        .sort();
      expect(routes).toEqual([
        'GET /availability',
        'GET /health',
        'GET /reservations',
        'GET /reservations/{id}',
        'GET /room-types',
        'POST /reservations',
        'POST /reservations/{id}/cancel',
        'POST /room-types',
        'POST /webhooks/channels/{channel}',
        'PUT /room-types/{id}/inventory',
      ]);
    });

    // Narrow view of the OpenAPI JSON, enough for the checks below.
    interface Op {
      requestBody?: {
        content: Record<string, { examples?: Record<string, unknown> }>;
      };
      responses: Record<
        string,
        {
          headers?: Record<string, unknown>;
          content?: Record<
            string,
            { examples?: Record<string, { value: unknown }> }
          >;
        }
      >;
    }
    async function openApi(): Promise<Record<string, Record<string, Op>>> {
      const res = await api().get('/docs-json').expect(200);
      return (res.body as { paths: Record<string, Record<string, Op>> }).paths;
    }
    const examplesOf = (op: Op, status: string) =>
      op.responses[status]?.content?.['application/json']?.examples ?? {};
    const codesOf = (op: Op, status: string) =>
      Object.values(examplesOf(op, status))
        .map((e) => (e.value as { error: { code: string } }).error.code)
        .sort();

    it('the write endpoints have request body examples', async () => {
      const paths = await openApi();
      for (const [path, method] of [
        ['/room-types', 'post'],
        ['/room-types/{id}/inventory', 'put'],
        ['/reservations', 'post'],
        ['/webhooks/channels/{channel}', 'post'],
      ]) {
        const examples =
          paths[path][method].requestBody?.content['application/json']
            ?.examples;
        expect(
          Object.keys(examples ?? {}).length,
          `${method} ${path}`,
        ).toBeGreaterThan(0);
      }
    });

    it('each endpoint documents its own 409 cases', async () => {
      const paths = await openApi();
      expect(codesOf(paths['/reservations'].post, '409')).toEqual([
        'INVALID_STATE',
        'ROOM_UNAVAILABLE',
      ]);
      expect(codesOf(paths['/reservations/{id}/cancel'].post, '409')).toEqual([
        'INVALID_STATE',
      ]);
      expect(codesOf(paths['/room-types'].post, '409')).toEqual([
        'INVALID_STATE',
      ]);
    });

    it('documents X-Request-Id on errors and Idempotent-Replayed on create', async () => {
      const paths = await openApi();
      const create = paths['/reservations'].post;
      expect(Object.keys(create.responses['201'].headers ?? {})).toEqual(
        expect.arrayContaining(['X-Request-Id', 'Idempotent-Replayed']),
      );
      expect(create.responses['400'].headers).toHaveProperty('X-Request-Id');
    });

    it('documented 401 bodies match what the API really returns', async () => {
      const paths = await openApi();
      const withoutRequestId = (body: unknown) => {
        const { error } = body as { error: Record<string, unknown> };
        return { ...error, requestId: undefined };
      };

      const apiKeyExample = Object.values(
        examplesOf(paths['/reservations'].post, '401'),
      )[0].value;
      const real = await api().post('/reservations').send({}).expect(401);
      expect(withoutRequestId(real.body)).toEqual(
        withoutRequestId(apiKeyExample),
      );

      // The webhook's 401 is INVALID_SIGNATURE, not the API-key one.
      const sigExample = Object.values(
        examplesOf(paths['/webhooks/channels/{channel}'].post, '401'),
      )[0].value;
      const realSig = await api()
        .post('/webhooks/channels/channel-a')
        .set('X-Signature', 'sha256=00')
        .send({})
        .expect(401);
      expect(withoutRequestId(realSig.body)).toEqual(
        withoutRequestId(sigExample),
      );
    });

    it('serves the Swagger UI at /docs', async () => {
      const res = await api().get('/docs').redirects(1).expect(200);
      expect(res.text).toContain('swagger');
    });
  });
});
