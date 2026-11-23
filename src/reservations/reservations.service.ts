import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model, QueryFilter } from 'mongoose';
import { Types } from 'mongoose';
import {
  InvalidStateException,
  NotFoundException,
  ValidationException,
} from '../common/errors/app-exception.js';
import { isDuplicateKeyError } from '../common/mongo-errors.js';
import { parseStay } from '../common/nights.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { IdempotencyCache } from '../redis/idempotency-cache.service.js';
import { LockOutcome, RedisLockService } from '../redis/redis-lock.service.js';
import { RoomTypesService } from '../room-types/room-types.service.js';
import {
  assertSameRequest,
  isSameRequest,
  parseIdempotencyKey,
  StayRequest,
} from './idempotency.js';
import {
  Reservation,
  ReservationDocument,
  ReservationStatus,
} from './reservation.schema.js';
import {
  CreateReservationDto,
  ListReservationsQueryDto,
  ReservationListResponseDto,
  ReservationResponseDto,
} from './reservations.dto.js';

/** Layer B lease: long enough for a 30-night claim, short enough to recover fast. */
const LOCK_OPTIONS = { ttlMs: 5000, waitMs: 3000 };
const IDEMPOTENCY_SCOPE = 'reservations';

export interface CreateReservationResult {
  reservation: ReservationResponseDto;
  /** True when an Idempotency-Key retry returned the original reservation. */
  replayed: boolean;
}

/** A booking as a channel sends it (Phase 4 webhook). */
export interface ChannelBooking extends StayRequest {
  source: string;
  externalId: string;
}

export interface ChannelBookingResult {
  reservation: ReservationResponseDto;
  /** True when the booking/cancel had already been applied (no change made). */
  alreadyApplied: boolean;
}

interface CachedCreate {
  request: StayRequest;
  response: ReservationResponseDto;
}

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    @InjectModel(Reservation.name)
    private readonly reservations: Model<Reservation>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventory: InventoryService,
    private readonly roomTypes: RoomTypesService,
    private readonly locks: RedisLockService,
    private readonly idempotency: IdempotencyCache,
  ) {}

  /**
   * Books [checkIn, checkOut) all-or-nothing (spec section 5).
   *
   *  Layer C  Idempotency-Key: a retry returns the original reservation.
   *           Redis is a 24h cache; the durable record is the unique
   *           idempotencyKey index on the reservation itself.
   *  Layer B  per-room-type Redis lease lock: fewer write conflicts. Optional.
   *  Layer A  one transaction: conditional $inc on every night + insert. THE
   *           guarantee; it holds with Redis down or the lock expired.
   */
  async create(
    dto: CreateReservationDto,
    rawIdempotencyKey?: string,
  ): Promise<CreateReservationResult> {
    const started = Date.now();
    const idempotencyKey = parseIdempotencyKey(rawIdempotencyKey);
    const nights = parseStay(dto.checkIn, dto.checkOut);

    if (idempotencyKey) {
      const replay = await this.findReplay(dto, idempotencyKey);
      if (replay) return { reservation: replay, replayed: true };
    }

    let doc: ReservationDocument;
    let lock: string;
    try {
      ({ doc, lock } = await this.book({
        ...toStayRequest(dto),
        nights,
        ...(idempotencyKey && { idempotencyKey }),
      }));
    } catch (err) {
      // Same key, racing request won the insert: its transaction committed and
      // ours aborted (our claimed nights were rolled back). Return the winner.
      if (idempotencyKey && isDuplicateKeyError(err)) {
        const replay = await this.findReplay(dto, idempotencyKey);
        if (replay) return { reservation: replay, replayed: true };
      }
      throw err;
    }

    const reservation = toReservationResponse(doc);
    if (idempotencyKey) {
      await this.idempotency.set(IDEMPOTENCY_SCOPE, idempotencyKey, {
        request: toStayRequest(dto),
        response: reservation,
      } satisfies CachedCreate);
    }
    this.logger.log(
      `reservation created reservationId=${reservation.id} roomTypeId=${reservation.roomTypeId} nights=${nights.length} lock=${lock} durationMs=${Date.now() - started}`,
    );
    return { reservation, replayed: false };
  }

  /**
   * Cancels and releases every night, in one transaction. Two concurrent
   * cancels can't both release: the second one hits a WriteConflict on the
   * reservation, retries, then sees CANCELLED and gets 409.
   */
  async cancel(id: string): Promise<ReservationResponseDto> {
    const _id = new Types.ObjectId(id);
    const doc = await this.connection.transaction(async (session) => {
      const existing = await this.reservations.findById(_id, null, {
        session,
      });
      if (!existing) {
        throw new NotFoundException('Reservation not found', {
          reservationId: id,
        });
      }
      if (existing.status === ReservationStatus.CANCELLED) {
        throw new InvalidStateException('Reservation is already cancelled', {
          reservationId: id,
          status: existing.status,
        });
      }

      const updated = await this.reservations.findOneAndUpdate(
        { _id, status: ReservationStatus.CONFIRMED },
        {
          $set: {
            status: ReservationStatus.CANCELLED,
            cancelledAt: new Date(),
          },
        },
        { session, returnDocument: 'after' },
      );
      if (!updated) {
        throw new InvalidStateException('Reservation is already cancelled', {
          reservationId: id,
        });
      }
      await this.inventory.release(
        existing.roomTypeId,
        existing.nights,
        session,
      );
      return updated;
    });

    this.logger.log(
      `reservation cancelled reservationId=${id} roomTypeId=${doc.roomTypeId.toString()}`,
    );
    return toReservationResponse(doc);
  }

  /**
   * booking.created from a channel (Phase 4). Same Layer A/B path as the API.
   * The unique (source, externalId) index guarantees one reservation per
   * channel booking, even if the channel sends it under several eventIds.
   * A booking that already exists with the same stay is returned as-is
   * (checked BEFORE claiming, so a redelivery never fails on a now-full night);
   * one with different details is a conflict (409 INVALID_STATE).
   */
  async createFromChannel(
    booking: ChannelBooking,
  ): Promise<ChannelBookingResult> {
    const started = Date.now();
    const nights = parseStay(booking.checkIn, booking.checkOut);
    const existing = await this.findExisting(booking);
    if (existing) return existing;

    try {
      const { doc, lock } = await this.book({ ...booking, nights });
      const reservation = toReservationResponse(doc);
      this.logger.log(
        `reservation created reservationId=${reservation.id} roomTypeId=${reservation.roomTypeId} source=${booking.source} nights=${nights.length} lock=${lock} durationMs=${Date.now() - started}`,
      );
      return { reservation, alreadyApplied: false };
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const winner = await this.findExisting(booking);
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * booking.cancelled from a channel. 404 if we never saw the booking (e.g. the
   * cancel arrived first); cancelling twice is a no-op, not an error.
   */
  async cancelFromChannel(
    source: string,
    externalId: string,
  ): Promise<ChannelBookingResult> {
    const find = () => this.reservations.findOne({ source, externalId });
    const existing = await find();
    if (!existing) {
      throw new NotFoundException('No reservation for this channel booking', {
        source,
        externalId,
      });
    }
    if (existing.status === ReservationStatus.CANCELLED) {
      return {
        reservation: toReservationResponse(existing),
        alreadyApplied: true,
      };
    }
    try {
      const reservation = await this.cancel(existing._id.toString());
      return { reservation, alreadyApplied: false };
    } catch (err) {
      // Lost a race with another cancel: fine, it's cancelled.
      const now = err instanceof InvalidStateException ? await find() : null;
      if (now?.status === ReservationStatus.CANCELLED) {
        return {
          reservation: toReservationResponse(now),
          alreadyApplied: true,
        };
      }
      throw err;
    }
  }

  private async findExisting(
    booking: ChannelBooking,
  ): Promise<ChannelBookingResult | undefined> {
    const existing = await this.reservations.findOne({
      source: booking.source,
      externalId: booking.externalId,
    });
    if (!existing) return undefined;
    if (!isSameRequest(booking, toStoredRequest(existing))) {
      throw new InvalidStateException(
        'This channel booking already exists with different details',
        {
          source: booking.source,
          externalId: booking.externalId,
          reservationId: existing._id.toString(),
        },
      );
    }
    return {
      reservation: toReservationResponse(existing),
      alreadyApplied: true,
    };
  }

  /**
   * Layers B + A, shared by the API and the channel webhook: per-room-type
   * lock (optional), then one transaction that claims every night and inserts
   * the reservation. Throws 404 / 409 ROOM_UNAVAILABLE / E11000.
   */
  private async book(
    params: StayRequest & {
      nights: string[];
      source?: string;
      externalId?: string;
      idempotencyKey?: string;
    },
  ): Promise<{ doc: ReservationDocument; lock: LockOutcome }> {
    await this.roomTypes.assertExists(params.roomTypeId);
    const roomTypeId = new Types.ObjectId(params.roomTypeId);

    return this.locks.withLock(
      `lock:rt:${params.roomTypeId}`,
      LOCK_OPTIONS,
      async (lock) => {
        // connection.transaction() retries the whole callback on transient
        // errors (WriteConflict). Our own exceptions abort it immediately.
        const doc = await this.connection.transaction(async (session) => {
          await this.inventory.claim(roomTypeId, params.nights, session);
          const [reservation] = await this.reservations.create(
            [
              {
                roomTypeId,
                checkIn: params.checkIn,
                checkOut: params.checkOut,
                nights: params.nights,
                guest: params.guest,
                ...(params.source && { source: params.source }),
                ...(params.externalId && { externalId: params.externalId }),
                ...(params.idempotencyKey && {
                  idempotencyKey: params.idempotencyKey,
                }),
              },
            ],
            { session },
          );
          return reservation;
        });
        return { doc, lock };
      },
    );
  }

  /**
   * Looks the key up in Redis, then in MongoDB (the durable record). Throws 409
   * if the key belongs to a different request. Undefined = first use.
   * Failed requests are never stored: their transaction aborted, so nothing
   * was booked and retrying them is safe.
   */
  private async findReplay(
    dto: CreateReservationDto,
    key: string,
  ): Promise<ReservationResponseDto | undefined> {
    const cached = await this.idempotency.get<CachedCreate>(
      IDEMPOTENCY_SCOPE,
      key,
    );
    if (cached) {
      assertSameRequest(toStayRequest(dto), cached.request);
      return cached.response;
    }

    const existing = await this.reservations.findOne({ idempotencyKey: key });
    if (!existing) return undefined;
    const original = toStoredRequest(existing);
    assertSameRequest(toStayRequest(dto), original);
    const response = toReservationResponse(existing);
    await this.idempotency.set(IDEMPOTENCY_SCOPE, key, {
      request: original,
      response,
    } satisfies CachedCreate);
    return response;
  }

  async get(id: string): Promise<ReservationResponseDto> {
    const doc = await this.reservations.findById(id);
    if (!doc) {
      throw new NotFoundException('Reservation not found', {
        reservationId: id,
      });
    }
    return toReservationResponse(doc);
  }

  async list(q: ListReservationsQueryDto): Promise<ReservationListResponseDto> {
    if (q.from && q.to && q.from >= q.to) {
      throw new ValidationException('from must be before to', {
        from: q.from,
        to: q.to,
      });
    }

    const filter: QueryFilter<Reservation> = {};
    if (q.roomTypeId) filter.roomTypeId = new Types.ObjectId(q.roomTypeId);
    if (q.status) filter.status = q.status;
    // Overlap with the window [from, to): the stay [checkIn, checkOut) has at
    // least one night in it. Check-out is exclusive, hence the strict comparisons.
    if (q.from) filter.checkOut = { $gt: q.from };
    if (q.to) filter.checkIn = { $lt: q.to };

    const [docs, total] = await Promise.all([
      this.reservations
        .find(filter)
        .sort({ createdAt: -1, _id: -1 }) // newest first; _id breaks ties
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      this.reservations.countDocuments(filter),
    ]);

    return {
      items: docs.map(toReservationResponse),
      page: q.page,
      limit: q.limit,
      total,
    };
  }
}

function toStayRequest(dto: CreateReservationDto): StayRequest {
  return {
    roomTypeId: dto.roomTypeId,
    checkIn: dto.checkIn,
    checkOut: dto.checkOut,
    guest: { name: dto.guest.name, email: dto.guest.email },
  };
}

function toStoredRequest(doc: ReservationDocument): StayRequest {
  return {
    roomTypeId: doc.roomTypeId.toString(),
    checkIn: doc.checkIn,
    checkOut: doc.checkOut,
    guest: { name: doc.guest.name, email: doc.guest.email },
  };
}

export function toReservationResponse(
  doc: ReservationDocument,
): ReservationResponseDto {
  return {
    id: doc._id.toString(),
    roomTypeId: doc.roomTypeId.toString(),
    checkIn: doc.checkIn,
    checkOut: doc.checkOut,
    nights: [...doc.nights],
    guest: { name: doc.guest.name, email: doc.guest.email },
    status: doc.status,
    source: doc.source,
    ...(doc.externalId !== undefined && { externalId: doc.externalId }),
    createdAt: doc.createdAt.toISOString(),
    ...(doc.cancelledAt && { cancelledAt: doc.cancelledAt.toISOString() }),
  };
}
