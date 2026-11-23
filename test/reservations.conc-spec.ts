import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { Inventory } from '../src/inventory/inventory.schema.js';
import { Reservation } from '../src/reservations/reservation.schema.js';
import {
  API_KEY,
  clearDatabase,
  createTestApp,
  race,
  stay,
  tally,
} from './helpers.js';

/**
 * The Phase 3 "done when" test: many parallel bookings for the last unit.
 * Real HTTP on a real port, real Mongo transactions, real Redis lock.
 */
describe('double-booking under concurrency', () => {
  let app: INestApplication<App>;
  let baseUrl: string;
  let inventory: Model<Inventory>;
  let reservations: Model<Reservation>;

  async function createRoomType(totalUnits: number) {
    const res = await request(app.getHttpServer())
      .post('/room-types')
      .set('X-Api-Key', API_KEY)
      .send({
        name: `RT ${totalUnits}`,
        totalUnits,
        seedFrom: '2026-12-24',
        seedTo: '2027-01-01',
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function rows(roomTypeId: string) {
    return inventory
      .find({ roomTypeId: new Types.ObjectId(roomTypeId) })
      .sort({ date: 1 })
      .lean();
  }

  beforeAll(async () => {
    app = await createTestApp();
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

  it('50 parallel requests for the last unit: exactly 1 succeeds, booked ends at 1', async () => {
    const rt = await createRoomType(1);
    const results = await race(
      baseUrl,
      Array.from({ length: 50 }, () =>
        stay(rt, { checkIn: '2026-12-24', checkOut: '2026-12-27' }),
      ),
    );

    console.log('50 requests, 1 unit:', tally(results));
    expect(tally(results)).toEqual({ '201': 1, '409 ROOM_UNAVAILABLE': 49 });
    const booked = (await rows(rt)).slice(0, 3).map((r) => r.booked);
    expect(booked).toEqual([1, 1, 1]);
    expect(await reservations.countDocuments()).toBe(1);
  });

  it('50 parallel requests for 5 units: exactly 5 succeed', async () => {
    const rt = await createRoomType(5);
    const results = await race(
      baseUrl,
      Array.from({ length: 50 }, () => stay(rt)),
    );
    expect(tally(results)).toEqual({ '201': 5, '409 ROOM_UNAVAILABLE': 45 });
    expect((await rows(rt))[0].booked).toBe(5);
  });

  it('50 overlapping multi-night stays: every night ends with booked == confirmed reservations <= total', async () => {
    const rt = await createRoomType(3);
    const nights = [
      '2026-12-24',
      '2026-12-25',
      '2026-12-26',
      '2026-12-27',
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ];
    // Deterministic spread of stays of 1..4 nights across the window.
    const bodies = Array.from({ length: 50 }, (_, i) => {
      const start = (i * 7) % (nights.length - 4);
      const len = 1 + (i % 4);
      return stay(rt, {
        checkIn: nights[start],
        checkOut: nights[start + len],
      });
    });
    const results = await race(baseUrl, bodies);
    const t = tally(results);
    expect((t['201'] ?? 0) + (t['409 ROOM_UNAVAILABLE'] ?? 0)).toBe(50);

    const confirmed = await reservations.find({ status: 'CONFIRMED' }).lean();
    expect(confirmed.length).toBe(t['201']);
    for (const row of await rows(rt)) {
      const expected = confirmed.filter((r) =>
        r.nights.includes(row.date),
      ).length;
      expect({ date: row.date, booked: row.booked }).toEqual({
        date: row.date,
        booked: expected,
      });
      expect(row.booked).toBeLessThanOrEqual(row.total);
    }
  });

  it('10 parallel cancels of one reservation: 1 succeeds, the night is released once', async () => {
    const rt = await createRoomType(2);
    const [kept] = await race(baseUrl, [stay(rt)]);
    const [target] = await race(baseUrl, [stay(rt)]);
    expect([kept.status, target.status]).toEqual([201, 201]);

    const cancels = await Promise.all(
      Array.from({ length: 10 }, () =>
        fetch(`${baseUrl}/reservations/${target.id}/cancel`, {
          method: 'POST',
          headers: { 'x-api-key': API_KEY },
        }).then((r) => r.status),
      ),
    );
    expect(cancels.filter((s) => s === 200)).toHaveLength(1);
    expect(cancels.filter((s) => s === 409)).toHaveLength(9);
    expect((await rows(rt))[0].booked).toBe(1);
  });
});
