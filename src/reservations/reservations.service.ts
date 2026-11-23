import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, QueryFilter } from 'mongoose';
import { Types } from 'mongoose';
import {
  NotFoundException,
  NotImplementedException,
  ValidationException,
} from '../common/errors/app-exception.js';
import { Reservation, ReservationDocument } from './reservation.schema.js';
import {
  CreateReservationDto,
  ListReservationsQueryDto,
  ReservationListResponseDto,
  ReservationResponseDto,
} from './reservations.dto.js';

@Injectable()
export class ReservationsService {
  constructor(
    @InjectModel(Reservation.name)
    private readonly reservations: Model<Reservation>,
  ) {}

  // ---------------------------------------------------------------------------
  // PHASE 3 (owner writes these two). Contract the controller already relies on:
  //
  // create(): validate the stay with parseStay() from common/nights.ts, claim
  //   every night all-or-nothing in one transaction, insert the reservation in
  //   the same session, return toReservationResponse(doc). Throw
  //   RoomUnavailableException (409) if any night is full. idempotencyKey is the
  //   optional Idempotency-Key header (Layer C).
  //
  // cancel(): 404 if unknown, InvalidStateException (409) if already
  //   CANCELLED, otherwise release every night and mark CANCELLED with
  //   cancelledAt, in one transaction. Return the updated reservation.
  // ---------------------------------------------------------------------------

  create(
    _dto: CreateReservationDto,
    _idempotencyKey?: string,
  ): Promise<ReservationResponseDto> {
    return Promise.reject(
      new NotImplementedException(
        'POST /reservations is implemented in Phase 3',
      ),
    );
  }

  cancel(_id: string): Promise<ReservationResponseDto> {
    return Promise.reject(
      new NotImplementedException(
        'POST /reservations/:id/cancel is implemented in Phase 3',
      ),
    );
  }

  // ---------------------------------------------------------------------------

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
