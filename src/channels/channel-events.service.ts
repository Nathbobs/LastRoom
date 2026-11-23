import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import {
  AppException,
  ErrorCode,
  ValidationException,
} from '../common/errors/app-exception.js';
import { isDuplicateKeyError } from '../common/mongo-errors.js';
import {
  ChannelBookingResult,
  ReservationsService,
} from '../reservations/reservations.service.js';
import {
  ChannelEvent,
  ChannelEventDocument,
  ChannelEventError,
  ChannelEventStatus,
  ChannelEventType,
} from './channel-event.schema.js';
import {
  BookingCancelledDataDto,
  BookingCreatedDataDto,
  parseEventData,
  WebhookEnvelopeDto,
  WebhookOutcome,
  WebhookResponseDto,
} from './channels.dto.js';

/**
 * A RECEIVED event older than this is assumed stuck (the process died while
 * handling it) and a redelivery may take it over. Far longer than a booking.
 */
export const STALE_AFTER_MS = 30_000;

type StoredPayload = {
  eventId: string;
  type: string;
  data: Record<string, unknown>;
};

/**
 * The webhook pipeline after the signature check (spec section 6):
 *
 *  2. INSERT the event as RECEIVED. The unique (source, eventId) index decides
 *     who processes it: a second delivery gets E11000 and is answered
 *     "duplicate" without doing anything. No read-then-write race is possible.
 *  3. PROCESS through the Phase 3 reservation service (same transaction,
 *     lock and invariants as the API).
 *  4. MARK it PROCESSED or FAILED. Failed events are kept, never deleted.
 *
 * Redeliveries normally do nothing. Two exceptions, both claimed atomically so
 * only one redelivery wins: an event that FAILED for an unexpected reason
 * (retryable) and an event stuck in RECEIVED for longer than STALE_AFTER_MS.
 * Reprocessing is safe because the reservation side is itself idempotent
 * (unique (source, externalId), and cancelling twice is a no-op).
 */
@Injectable()
export class ChannelEventsService {
  private readonly logger = new Logger(ChannelEventsService.name);

  constructor(
    @InjectModel(ChannelEvent.name)
    private readonly events: Model<ChannelEvent>,
    private readonly reservations: ReservationsService,
  ) {}

  async receive(
    source: string,
    envelope: WebhookEnvelopeDto,
  ): Promise<WebhookResponseDto> {
    const payload: StoredPayload = {
      eventId: envelope.eventId,
      type: envelope.type,
      data: envelope.data,
    };

    let event: ChannelEventDocument;
    try {
      event = await this.events.create({
        source,
        eventId: envelope.eventId,
        type: envelope.type,
        payload,
        status: ChannelEventStatus.RECEIVED,
      });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const reclaimed = await this.reclaim(source, envelope.eventId);
      if (!reclaimed) return this.duplicate(source, envelope.eventId);
      event = reclaimed;
    }
    return this.process(event);
  }

  /** Takes over a retryable FAILED or a stuck RECEIVED event; null if neither. */
  private async reclaim(
    source: string,
    eventId: string,
  ): Promise<ChannelEventDocument | null> {
    const now = new Date();
    return this.events.findOneAndUpdate(
      {
        source,
        eventId,
        $or: [
          { status: ChannelEventStatus.FAILED, retryable: true },
          {
            status: ChannelEventStatus.RECEIVED,
            processingStartedAt: {
              $lt: new Date(now.getTime() - STALE_AFTER_MS),
            },
          },
        ],
      },
      {
        $set: {
          status: ChannelEventStatus.RECEIVED,
          processingStartedAt: now,
          retryable: false,
        },
        $unset: { error: 1, processedAt: 1 },
        $inc: { attempts: 1 },
      },
      { returnDocument: 'after' },
    );
  }

  private async duplicate(
    source: string,
    eventId: string,
  ): Promise<WebhookResponseDto> {
    const existing = await this.events.findOne({ source, eventId }).lean();
    this.logger.log(
      `channel event duplicate source=${source} eventId=${eventId} eventStatus=${existing?.status}`,
    );
    return {
      status: WebhookOutcome.DUPLICATE,
      eventId,
      // The insert failed on the unique index, so the event exists.
      eventStatus: existing?.status ?? ChannelEventStatus.RECEIVED,
      ...(existing?.reservationId && {
        reservationId: existing.reservationId.toString(),
      }),
      ...(existing?.error && {
        error: { code: existing.error.code, message: existing.error.message },
      }),
    };
  }

  private async process(
    event: ChannelEventDocument,
  ): Promise<WebhookResponseDto> {
    const started = Date.now();
    const log = `source=${event.source} eventId=${event.eventId} type=${event.type} attempt=${event.attempts}`;
    try {
      const result = await this.apply(event);
      const reservationId = new Types.ObjectId(result.reservation.id);
      await this.events.updateOne(
        { _id: event._id },
        {
          $set: {
            status: ChannelEventStatus.PROCESSED,
            processedAt: new Date(),
            reservationId,
          },
        },
      );
      this.logger.log(
        `channel event processed ${log} reservationId=${result.reservation.id} alreadyApplied=${result.alreadyApplied} durationMs=${Date.now() - started}`,
      );
      return {
        status: WebhookOutcome.PROCESSED,
        eventId: event.eventId,
        eventStatus: ChannelEventStatus.PROCESSED,
        reservationId: result.reservation.id,
      };
    } catch (err) {
      // Our own exceptions are about the event itself (full night, unknown
      // booking, bad data): final. Anything else is unexpected: retryable.
      const expected = err instanceof AppException;
      const error: ChannelEventError = expected
        ? { code: err.code, message: err.message, details: err.details }
        : {
            code: ErrorCode.INTERNAL_ERROR,
            message: 'Unexpected error while processing the event',
          };
      try {
        await this.events.updateOne(
          { _id: event._id },
          {
            $set: {
              status: ChannelEventStatus.FAILED,
              error,
              retryable: !expected,
              processedAt: new Date(),
            },
          },
        );
      } catch (markErr) {
        // Left as RECEIVED: a redelivery after STALE_AFTER_MS takes it over.
        this.logger.error(
          `could not mark channel event FAILED ${log}: ${String(markErr)}`,
        );
      }
      this.logger.warn(
        `channel event failed ${log} code=${error.code} retryable=${!expected} durationMs=${Date.now() - started}`,
      );
      // Unexpected: answer 500 so the channel redelivers, and we retry then.
      if (!expected) throw err;
      return {
        status: WebhookOutcome.FAILED,
        eventId: event.eventId,
        eventStatus: ChannelEventStatus.FAILED,
        error: { code: error.code, message: error.message },
      };
    }
  }

  /** Step 3: the event's effect, via the Phase 3 reservation service. */
  private apply(event: ChannelEventDocument): Promise<ChannelBookingResult> {
    const { data } = event.payload as unknown as StoredPayload;
    switch (event.type) {
      case ChannelEventType.BOOKING_CREATED: {
        const booking = parseEventData(BookingCreatedDataDto, data);
        return this.reservations.createFromChannel({
          source: event.source,
          externalId: booking.externalId,
          roomTypeId: booking.roomTypeId,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          guest: { name: booking.guest.name, email: booking.guest.email },
        });
      }
      case ChannelEventType.BOOKING_CANCELLED: {
        const { externalId } = parseEventData(BookingCancelledDataDto, data);
        return this.reservations.cancelFromChannel(event.source, externalId);
      }
      default:
        return Promise.reject(
          new ValidationException(`Unsupported event type "${event.type}"`, {
            type: event.type,
            supported: Object.values(ChannelEventType),
          }),
        );
    }
  }
}
