import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { ChannelEvent } from '../src/channels/channel-event.schema.js';
import { Inventory } from '../src/inventory/inventory.schema.js';
import { Reservation } from '../src/reservations/reservation.schema.js';
import {
  API_KEY,
  bookingEvent,
  clearDatabase,
  createTestApp,
  deliverWebhook,
  race,
  stay,
  tally,
} from './helpers.js';

/** Phase 4 "done when": parallel redeliveries never create a second reservation. */
describe('webhook idempotency under concurrency', () => {
  let app: INestApplication<App>;
  let baseUrl: string;
  let events: Model<ChannelEvent>;
  let reservations: Model<Reservation>;
  let inventory: Model<Inventory>;

  async function createRoomType(totalUnits: number) {
    const res = await request(app.getHttpServer())
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

  function outcomes(results: { status: number; outcome?: string }[]) {
    const out: Record<string, number> = {};
    for (const r of results) {
      const k = `${r.status} ${r.outcome}`;
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = await app.getUrl();
    events = app.get(getModelToken(ChannelEvent.name));
    reservations = app.get(getModelToken(Reservation.name));
    inventory = app.get(getModelToken(Inventory.name));
  });

  beforeEach(async () => {
    await clearDatabase(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([5, 50])(
    'the same event delivered %i times in parallel: exactly one reservation',
    async (n) => {
      const rt = await createRoomType(5);
      const results = await Promise.all(
        Array.from({ length: n }, () =>
          deliverWebhook(baseUrl, bookingEvent('evt_parallel', rt)),
        ),
      );
      console.log(`same event x${n} in parallel:`, outcomes(results));
      expect(outcomes(results)).toEqual({
        '200 processed': 1,
        '200 duplicate': n - 1,
      });
      expect(await reservations.countDocuments()).toBe(1);
      expect(await events.countDocuments()).toBe(1);
      const row = await inventory
        .findOne({ roomTypeId: new Types.ObjectId(rt), date: '2026-12-24' })
        .lean();
      expect(row?.booked).toBe(1);
    },
  );

  it('the same booking under 20 different eventIds in parallel: one reservation, 20 events', async () => {
    const rt = await createRoomType(5);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        deliverWebhook(baseUrl, bookingEvent(`evt_${i}`, rt)),
      ),
    );
    expect(outcomes(results)).toEqual({ '200 processed': 20 });
    expect(await reservations.countDocuments()).toBe(1);
    expect(await events.countDocuments({ status: 'PROCESSED' })).toBe(20);
    const ids = await events.distinct('reservationId');
    expect(ids).toHaveLength(1);
  });

  it('channel bookings and direct bookings racing for the last unit: exactly one wins', async () => {
    const rt = await createRoomType(1);
    const [channel, direct] = await Promise.all([
      Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          deliverWebhook(
            baseUrl,
            bookingEvent(`evt_race_${i}`, rt, { externalId: `CHA-${i}` }),
          ),
        ),
      ),
      race(
        baseUrl,
        Array.from({ length: 25 }, () => stay(rt)),
      ),
    ]);
    const channelWins = channel.filter((r) => r.outcome === 'processed').length;
    const directWins = direct.filter((r) => r.status === 201).length;
    console.log('25 channel + 25 direct for 1 unit:', {
      channel: outcomes(channel),
      direct: tally(direct),
    });

    expect(channelWins + directWins).toBe(1);
    expect(await reservations.countDocuments()).toBe(1);
    // Every losing channel event is kept as the overbooking signal.
    expect(
      await events.countDocuments({
        status: 'FAILED',
        'error.code': 'ROOM_UNAVAILABLE',
      }),
    ).toBe(25 - channelWins);
    const row = await inventory
      .findOne({ roomTypeId: new Types.ObjectId(rt), date: '2026-12-24' })
      .lean();
    expect(row?.booked).toBe(1);
  });
});
