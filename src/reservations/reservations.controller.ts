import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrors } from '../common/error-response.dto.js';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe.js';
import {
  CreateReservationDto,
  ListReservationsQueryDto,
  ReservationListResponseDto,
  ReservationResponseDto,
} from './reservations.dto.js';
import { ReservationsService } from './reservations.service.js';

@ApiTags('reservations')
@ApiSecurity('api-key')
@ApiErrors(401)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a reservation',
    description:
      'Claims every night of [checkIn, checkOut) all-or-nothing; 409 ROOM_UNAVAILABLE if any night is full. ' +
      'With an Idempotency-Key, a retry returns the original reservation (header Idempotent-Replayed: true); ' +
      'reusing a key for a different request is 409 INVALID_STATE.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Retries with the same key return the original response instead of booking twice.',
  })
  @ApiCreatedResponse({ type: ReservationResponseDto })
  @ApiErrors(400, 404, 409)
  async create(
    @Body() dto: CreateReservationDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ReservationResponseDto> {
    const { reservation, replayed } = await this.reservations.create(
      dto,
      idempotencyKey,
    );
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return reservation;
  }

  @Get()
  @ApiOperation({ summary: 'List reservations (paginated, newest first)' })
  @ApiOkResponse({ type: ReservationListResponseDto })
  @ApiErrors(400)
  list(
    @Query() q: ListReservationsQueryDto,
  ): Promise<ReservationListResponseDto> {
    return this.reservations.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one reservation' })
  @ApiOkResponse({ type: ReservationResponseDto })
  @ApiErrors(400, 404)
  get(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ReservationResponseDto> {
    return this.reservations.get(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a reservation and release its nights',
  })
  @ApiOkResponse({ type: ReservationResponseDto })
  @ApiErrors(400, 404, 409)
  cancel(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ReservationResponseDto> {
    return this.reservations.cancel(id);
  }
}
