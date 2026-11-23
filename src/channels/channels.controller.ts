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
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/api-key.guard.js';
import { ApiErrors } from '../common/error-response.dto.js';
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
      'sha256=<hex HMAC-SHA256 of the raw body with the channel secret>',
  })
  @ApiOkResponse({ type: WebhookResponseDto })
  @ApiErrors(400, 401)
  receive(
    @Param('channel') channel: string,
    @Body() envelope: WebhookEnvelopeDto,
  ): Promise<WebhookResponseDto> {
    return this.events.receive(channel, envelope);
  }
}
