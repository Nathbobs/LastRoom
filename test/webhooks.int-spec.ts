import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { ChannelEvent } from '../src/channels/channel-event.schema.js';
import { signBody } from '../src/channels/channel-signature.guard.js';
import { STALE_AFTER_MS } from '../src/channels/channel-events.service.js';
import { Inventory } from '../src/inventory/inventory.schema.js';
import { Reservation } from '../src/reservations/reservation.schema.js';
import { ReservationsService } from '../src/reservations/reservations.service.js';
import {
  API_KEY,
  bookingEvent,
  cancelEvent,
  CHANNEL_SECRETS,
  clearDatabase,
  createTestApp,
  stay,
} from './helpers.js';

/** Phase 4: signed webhook + event inbox against REAL Mongo and Redis. */
describe('Phase 4 channel webhook (integration)', () => {
  let app: INestApplication<App>;
  let events: Model<ChannelEvent>;
  let reservations: Model<Reservation>;
  let inventory: Model<Inventory>;
  let rt: string;

  const api = () => request(app.getHttpServer());

  /** Sends the body exactly as signed (raw string, not re-serialised by supertest). */
  function deliver(
    body: object | string,
    opts: { channel?: string; secret?: string; signature?: string } = {},
  ) {
    const channel = opts.channel ?? 'channel-a';
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const signature =
      opts.signature ??
      signBody(opts.secret ?? CHANNEL_SECRETS[channel] ?? 'x', raw);
    return api()
      .post(`/webhooks/channels/${channel}`)
      .set('content-type', 'application/json')
      .set('x-signature', signature)
      .send(raw);
  }

  async function createRoomType(totalUnits: number, name = 'Deluxe') {
    const res = await api()
      .post('/room-types')
      .set('X-Api-Key', API_KEY)
      .send({ name, totalUnits, seedFrom: '2026-12-24', seedTo: '2026-12-31' })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function booked(date = '2026-12-24') {
    const row = await inventory
      .findOne({ roomTypeId: new Types.ObjectId(rt), date })
      .lean();
    return row?.booked;
  }

  beforeAll(async () => {
    app = await createTestApp();
    events = app.get(getModelToken(ChannelEvent.name));
    reservations = app.get(getModelToken(Reservation.name));
    inventory = app.get(getModelToken(Inventory.name));
  });

  beforeEach(async () => {
    await clearDatabase(app);
    rt = await createRoomType(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('signature (step 1): bad signature -> 401, nothing recorded', () => {
    const body = () => bookingEvent('evt_sig', rt);

    it.each([
      ['missing', { signature: '' }],
      ['malformed', { signature: 'sha256=nothex' }],
      ['signed with the wrong secret', { secret: 'not-the-secret-0123456' }],
      [
        "signed with another channel's secret",
        { secret: CHANNEL_SECRETS['channel-b'] },
      ],
      ['for an unknown channel', { channel: 'channel-x', secret: 'whatever' }],
    ])('%s', async (_label, opts) => {
      const res = await deliver(body(), opts).expect(401);
      expect(res.body.error).toMatchObject({ code: 'INVALID_SIGNATURE' });
      expect(await events.countDocuments()).toBe(0);
      expect(await reservations.countDocuments()).toBe(0);
    });

    it('the body changed after signing (a re-serialised copy is NOT the signed bytes)', async () => {
      const raw = JSON.stringify(body());
      const signature = signBody(CHANNEL_SECRETS['channel-a'], raw);
      // Same JSON value, different bytes: whitespace added.
      await deliver(JSON.stringify(body(), null, 2), { signature }).expect(401);
      expect(await events.countDocuments()).toBe(0);
    });

    it('needs no API key, and an API key does not replace the signature', async () => {
      await deliver(body()).expect(200);
      await api()
        .post('/webhooks/channels/channel-a')
        .set('X-Api-Key', API_KEY)
        .send(bookingEvent('evt_sig_2', rt))
        .expect(401);
    });
  });

  it('400 for a signed but unusable envelope (no eventId): nothing recorded', async () => {
    const res = await deliver({ type: 'booking.created', data: {} }).expect(
      400,
    );
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await events.countDocuments()).toBe(0);
  });

  describe('booking.created', () => {
    it('creates the reservation through the Phase 3 path and records the event', async () => {
      const res = await deliver(bookingEvent('evt_1', rt)).expect(200);
      expect(res.body).toEqual({
        status: 'processed',
        eventId: 'evt_1',
        eventStatus: 'PROCESSED',
        reservationId: expect.any(String) as string,
      });

      const reservation = await reservations.findById(res.body.reservationId);
      expect(reservation).toMatchObject({
        source: 'channel-a',
        externalId: 'CHA-1001',
        status: 'CONFIRMED',
        nights: ['2026-12-24', '2026-12-25'],
      });
      expect(await booked('2026-12-24')).toBe(1);
      expect(await booked('2026-12-26')).toBe(0); // check-out day

      const event = await events.findOne({ eventId: 'evt_1' }).lean();
      expect(event).toMatchObject({
        source: 'channel-a',
        type: 'booking.created',
        status: 'PROCESSED',
        attempts: 1,
        retryable: false,
      });
      expect(event?.reservationId?.toString()).toBe(res.body.reservationId);
      expect(event?.processedAt).toBeInstanceOf(Date);
    });

    it('replaying the same event 5 times yields exactly one reservation', async () => {
      const statuses: string[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await deliver(bookingEvent('evt_replay', rt)).expect(200);
        statuses.push(res.body.status as string);
      }
      expect(statuses).toEqual([
        'processed',
        'duplicate',
        'duplicate',
        'duplicate',
        'duplicate',
      ]);
      expect(await reservations.countDocuments()).toBe(1);
      expect(await events.countDocuments()).toBe(1);
      expect(await booked()).toBe(1);
    });

    it('a duplicate reports the original outcome and reservation', async () => {
      const first = await deliver(bookingEvent('evt_dup', rt)).expect(200);
      const again = await deliver(bookingEvent('evt_dup', rt)).expect(200);
      expect(again.body).toEqual({
        status: 'duplicate',
        eventId: 'evt_dup',
        eventStatus: 'PROCESSED',
        reservationId: first.body.reservationId,
      });
    });

    it('the same booking under a different eventId does not book twice (unique source+externalId)', async () => {
      const first = await deliver(bookingEvent('evt_a', rt)).expect(200);
      const second = await deliver(bookingEvent('evt_b', rt)).expect(200);
      expect(second.body).toMatchObject({
        status: 'processed',
        reservationId: first.body.reservationId,
      });
      expect(await reservations.countDocuments()).toBe(1);
      expect(await events.countDocuments()).toBe(2);
      expect(await booked()).toBe(1);
    });

    it('the same externalId with DIFFERENT details is FAILED INVALID_STATE', async () => {
      await createRoomType(1, 'Other'); // unrelated, just to show nothing else changes
      await deliver(bookingEvent('evt_a', rt)).expect(200);
      const res = await deliver(
        bookingEvent('evt_b', rt, { checkOut: '2026-12-27' }),
      ).expect(200);
      expect(res.body).toMatchObject({
        status: 'failed',
        eventStatus: 'FAILED',
        error: { code: 'INVALID_STATE' },
      });
      expect(await reservations.countDocuments()).toBe(1);
    });

    it('the same externalId from two channels is two bookings', async () => {
      rt = await createRoomType(2, 'Twin');
      await deliver(bookingEvent('evt_1', rt)).expect(200);
      await deliver(bookingEvent('evt_1', rt), { channel: 'channel-b' }).expect(
        200,
      );
      expect(await reservations.countDocuments()).toBe(2);
      expect(await events.countDocuments()).toBe(2);
    });

    it('a full night: event FAILED with ROOM_UNAVAILABLE, kept, nothing claimed', async () => {
      await api()
        .post('/reservations')
        .set('X-Api-Key', API_KEY)
        .send(stay(rt, { checkIn: '2026-12-25', checkOut: '2026-12-26' }))
        .expect(201);

      const res = await deliver(bookingEvent('evt_full', rt)).expect(200);
      expect(res.body).toMatchObject({
        status: 'failed',
        eventStatus: 'FAILED',
        error: { code: 'ROOM_UNAVAILABLE' },
      });
      expect(await booked('2026-12-24')).toBe(0); // rolled back
      const event = await events.findOne({ eventId: 'evt_full' }).lean();
      expect(event).toMatchObject({
        status: 'FAILED',
        retryable: false,
        error: {
          code: 'ROOM_UNAVAILABLE',
          details: { night: '2026-12-25' },
        },
      });

      // Redelivery is not retried: the failure is about the event, not us.
      const again = await deliver(bookingEvent('evt_full', rt)).expect(200);
      expect(again.body).toMatchObject({
        status: 'duplicate',
        eventStatus: 'FAILED',
        error: { code: 'ROOM_UNAVAILABLE' },
      });
      expect(await reservations.countDocuments({ source: 'channel-a' })).toBe(
        0,
      );
    });

    it('bad data or an unknown room type: recorded as FAILED, not a 4xx', async () => {
      const bad = await deliver(
        bookingEvent('evt_bad', rt, { checkIn: '2026-02-30' }),
      ).expect(200);
      expect(bad.body).toMatchObject({
        status: 'failed',
        error: { code: 'VALIDATION_ERROR' },
      });

      const unknown = await deliver(
        bookingEvent('evt_unknown_rt', new Types.ObjectId().toString()),
      ).expect(200);
      expect(unknown.body).toMatchObject({
        status: 'failed',
        error: { code: 'NOT_FOUND' },
      });

      const type = await deliver({
        eventId: 'evt_type',
        type: 'booking.modified',
        data: {},
      }).expect(200);
      expect(type.body).toMatchObject({
        status: 'failed',
        error: { code: 'VALIDATION_ERROR' },
      });
      expect(await events.countDocuments({ status: 'FAILED' })).toBe(3);
    });
  });

  describe('booking.cancelled', () => {
    it('cancels the matching reservation and releases its nights', async () => {
      const created = await deliver(bookingEvent('evt_c1', rt)).expect(200);
      const res = await deliver(cancelEvent('evt_c2')).expect(200);
      expect(res.body).toMatchObject({
        status: 'processed',
        reservationId: created.body.reservationId,
      });
      expect(
        (await reservations.findById(created.body.reservationId))?.status,
      ).toBe('CANCELLED');
      expect(await booked()).toBe(0);
    });

    it('cancelling twice (new eventId) is a no-op, released only once', async () => {
      rt = await createRoomType(2, 'Twin');
      await api()
        .post('/reservations')
        .set('X-Api-Key', API_KEY)
        .send(stay(rt))
        .expect(201);
      await deliver(bookingEvent('evt_c1', rt)).expect(200);
      expect(await booked()).toBe(2);

      await deliver(cancelEvent('evt_c2')).expect(200);
      const twice = await deliver(cancelEvent('evt_c3')).expect(200);
      expect(twice.body).toMatchObject({ status: 'processed' });
      expect(await booked()).toBe(1);
    });

    it('a cancel that arrives BEFORE its booking is kept as FAILED NOT_FOUND', async () => {
      const early = await deliver(cancelEvent('evt_early')).expect(200);
      expect(early.body).toMatchObject({
        status: 'failed',
        error: { code: 'NOT_FOUND' },
      });
      // The booking then arrives and is applied; the cancel stays FAILED for
      // reconciliation (Phase 5) to flag.
      await deliver(bookingEvent('evt_late_create', rt)).expect(200);
      expect(await reservations.countDocuments({ status: 'CONFIRMED' })).toBe(
        1,
      );
      expect(
        (await events.findOne({ eventId: 'evt_early' }).lean())?.status,
      ).toBe('FAILED');
    });
  });

  describe('redelivery after an unexpected failure', () => {
    it('an unexpected error is 500, FAILED + retryable, and the next delivery processes it', async () => {
      const service = app.get(ReservationsService);
      vi.spyOn(service, 'createFromChannel').mockRejectedValueOnce(
        new Error('simulated database hiccup'),
      );

      const failed = await deliver(bookingEvent('evt_retry', rt)).expect(500);
      expect(failed.body.error).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(JSON.stringify(failed.body)).not.toContain('hiccup'); // not leaked
      expect(
        await events.findOne({ eventId: 'evt_retry' }).lean(),
      ).toMatchObject({
        status: 'FAILED',
        retryable: true,
        error: { code: 'INTERNAL_ERROR' },
      });

      const retried = await deliver(bookingEvent('evt_retry', rt)).expect(200);
      expect(retried.body).toMatchObject({ status: 'processed' });
      const event = await events.findOne({ eventId: 'evt_retry' }).lean();
      expect(event).toMatchObject({ status: 'PROCESSED', attempts: 2 });
      expect(event?.error).toBeUndefined();
      expect(await reservations.countDocuments()).toBe(1);
    });

    it('a RECEIVED event stuck past the lease is taken over; a fresh one is not', async () => {
      const payload = bookingEvent('evt_stuck', rt);
      await events.create({
        source: 'channel-a',
        eventId: 'evt_stuck',
        type: payload.type,
        payload,
        status: 'RECEIVED',
        processingStartedAt: new Date(Date.now() - STALE_AFTER_MS - 1000),
      });
      const res = await deliver(payload).expect(200);
      expect(res.body).toMatchObject({ status: 'processed' });

      const fresh = bookingEvent('evt_in_flight', rt, { externalId: 'CHA-2' });
      await events.create({
        source: 'channel-a',
        eventId: 'evt_in_flight',
        type: fresh.type,
        payload: fresh,
        status: 'RECEIVED',
      });
      const dup = await deliver(fresh).expect(200);
      expect(dup.body).toMatchObject({
        status: 'duplicate',
        eventStatus: 'RECEIVED',
      });
      expect(await reservations.countDocuments()).toBe(1);
    });
  });
});
