import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/api-key.guard.js';
import {
  ApiErrors,
  ApiSignatureError,
  REQUEST_ID_RESPONSE_HEADER,
} from '../common/error-response.dto.js';
import { ChannelEventsService } from './channel-events.service.js';
import {
  ChannelSignatureGuard,
  SIGNATURE_HEADER,
} from './channel-signature.guard.js';
import { WebhookEnvelopeDto, WebhookResponseDto } from './channels.dto.js';

/**
 * Channel webhook. No API key (@Public): channels authenticate with an HMAC of
 * the raw body instead, checked by ChannelSignatureGuard before the body is
 * validated or anything is stored.
 */
@ApiTags('channels')
@Public()
@Controller('webhooks/channels')
export class ChannelsController {
  constructor(private readonly events: ChannelEventsService) {}

  @Post(':channel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ChannelSignatureGuard)
  @ApiOperation({
    summary: 'Receive a booking.created / booking.cancelled event',
    description:
      'Every signed delivery is recorded in the event inbox before processing. ' +
      'Redelivering the same eventId returns 200 "duplicate" and changes nothing. ' +
      'An event that cannot be applied (e.g. full night) is kept as FAILED and answered 200 "failed".',
  })
  @ApiHeader({
    name: SIGNATURE_HEADER,
    required: true,
    description:
      'sha256=<hex HMAC-SHA256 of the exact raw request body, keyed with the channel secret>. ' +
      'Sign the bytes you send: re-serialising the JSON changes them. Example (Node): ' +
      "'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')",
  })
  @ApiBody({
    type: WebhookEnvelopeDto,
    examples: {
      created: {
        summary: 'booking.created',
        value: {
          eventId: 'evt_1001',
          type: 'booking.created',
          data: {
            externalId: 'CHA-1001',
            roomTypeId: '6b07c8c753db61eb67136efc',
            checkIn: '2026-12-24',
            checkOut: '2026-12-26',
            guest: { name: 'Grace Hopper', email: 'grace@example.com' },
          },
        },
      },
      cancelled: {
        summary: 'booking.cancelled',
        value: {
          eventId: 'evt_1002',
          type: 'booking.cancelled',
          data: { externalId: 'CHA-1001' },
        },
      },
    },
  })
  @ApiOkResponse({
    type: WebhookResponseDto,
    description:
      'The event was recorded. `status` says what this delivery did; `eventStatus` is the stored event state.',
    headers: REQUEST_ID_RESPONSE_HEADER,
    examples: {
      processed: {
        summary: 'First delivery, applied',
        value: {
          status: 'processed',
          eventId: 'evt_1001',
          eventStatus: 'PROCESSED',
          reservationId: '6b07c99453db61eb67136f15',
        },
      },
      duplicate: {
        summary: 'Redelivery of a known eventId: nothing changes',
        value: {
          status: 'duplicate',
          eventId: 'evt_1001',
          eventStatus: 'PROCESSED',
          reservationId: '6b07c99453db61eb67136f15',
        },
      },
      failed: {
        summary: 'Could not be applied (kept as FAILED, not retried)',
        value: {
          status: 'failed',
          eventId: 'evt_1003',
          eventStatus: 'FAILED',
          error: {
            code: 'ROOM_UNAVAILABLE',
            message: 'No units left on 2026-12-24 for this room type',
          },
        },
      },
    },
  })
  @ApiErrors(400)
  @ApiSignatureError()
  receive(
    @Param('channel') channel: string,
    @Body() envelope: WebhookEnvelopeDto,
  ): Promise<WebhookResponseDto> {
    return this.events.receive(channel, envelope);
  }
}
