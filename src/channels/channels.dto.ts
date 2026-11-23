import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { plainToInstance, Type } from 'class-transformer';
import {
  IsMongoId,
  IsObject,
  IsString,
  Length,
  Matches,
  ValidateNested,
  validateSync,
} from 'class-validator';
import { ValidationException } from '../common/errors/app-exception.js';
import { IsNight } from '../common/is-night.decorator.js';
import { flattenValidationErrors } from '../common/validation.js';
import { GuestDto } from '../reservations/reservations.dto.js';
import { ChannelEventStatus } from './channel-event.schema.js';

/** Channel ids: printable, no spaces, bounded (they end up in indexes and logs). */
const CHANNEL_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const CHANNEL_ID_MESSAGE =
  '$property must be 1-128 characters of A-Z a-z 0-9 . _ : -';

/**
 * The envelope is validated by the global pipe BEFORE the event is recorded:
 * without a usable eventId there is nothing to deduplicate on (400, nothing
 * stored). `data` is only checked to be an object here; its content is
 * validated during processing so that a bad booking is RECORDED as FAILED.
 */
export class WebhookEnvelopeDto {
  @ApiProperty({ example: 'evt_123' })
  @IsString()
  @Matches(CHANNEL_ID, { message: CHANNEL_ID_MESSAGE })
  eventId: string;

  @ApiProperty({
    example: 'booking.created',
    description:
      'booking.created or booking.cancelled; other types are recorded as FAILED.',
  })
  @IsString()
  @Length(1, 64)
  type: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      externalId: 'CHA-998877',
      roomTypeId: '6750f1c2a1b2c3d4e5f60718',
      checkIn: '2026-12-24',
      checkOut: '2026-12-27',
      guest: { name: 'Ada Lovelace', email: 'ada@example.com' },
    },
  })
  @IsObject()
  data: Record<string, unknown>;
}

export class BookingCancelledDataDto {
  @IsString()
  @Matches(CHANNEL_ID, { message: CHANNEL_ID_MESSAGE })
  externalId: string;
}

export class BookingCreatedDataDto extends BookingCancelledDataDto {
  @IsMongoId()
  roomTypeId: string;

  @IsNight()
  checkIn: string;

  @IsNight()
  checkOut: string;

  @ValidateNested()
  @Type(() => GuestDto)
  guest: GuestDto;
}

/**
 * Validates an event's `data` against a DTO. Unknown fields are dropped, not
 * rejected: channels add fields over time and that must not fail bookings.
 */
export function parseEventData<T extends object>(
  cls: new () => T,
  data: Record<string, unknown>,
): T {
  const instance = plainToInstance(cls, data);
  const errors = validateSync(instance, { whitelist: true });
  if (errors.length > 0) {
    throw new ValidationException('Event data validation failed', {
      fields: flattenValidationErrors(errors, 'data'),
    });
  }
  return instance;
}

export const WebhookOutcome = {
  PROCESSED: 'processed',
  DUPLICATE: 'duplicate',
  FAILED: 'failed',
} as const;
export type WebhookOutcome =
  (typeof WebhookOutcome)[keyof typeof WebhookOutcome];

export class WebhookErrorDto {
  @ApiProperty({ example: 'ROOM_UNAVAILABLE' })
  code: string;

  @ApiProperty({ example: 'No units left on 2026-12-25 for this room type' })
  message: string;
}

export class WebhookResponseDto {
  @ApiProperty({
    enum: Object.values(WebhookOutcome),
    description:
      'processed: done now. duplicate: this eventId was already received (nothing done). ' +
      'failed: recorded but could not be applied (kept for reconciliation; do not resend).',
  })
  status: WebhookOutcome;

  @ApiProperty({ example: 'evt_123' })
  eventId: string;

  @ApiProperty({ enum: Object.values(ChannelEventStatus) })
  eventStatus: ChannelEventStatus;

  @ApiPropertyOptional({ example: '6750f1c2a1b2c3d4e5f60719' })
  reservationId?: string;

  @ApiPropertyOptional({ type: WebhookErrorDto })
  error?: WebhookErrorDto;
}
