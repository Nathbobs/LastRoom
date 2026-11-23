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
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
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
    summary: 'Create a reservation (Phase 3: currently returns 501)',
    description:
      'Claims every night of [checkIn, checkOut) all-or-nothing; 409 ROOM_UNAVAILABLE if any night is full.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Retries with the same key return the original response instead of booking twice.',
  })
  @ApiCreatedResponse({ type: ReservationResponseDto })
  @ApiErrors(400, 404, 409, 501)
  create(
    @Body() dto: CreateReservationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ReservationResponseDto> {
    return this.reservations.create(dto, idempotencyKey);
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
    summary:
      'Cancel a reservation and release its nights (Phase 3: currently returns 501)',
  })
  @ApiOkResponse({ type: ReservationResponseDto })
  @ApiErrors(400, 404, 409, 501)
  cancel(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ReservationResponseDto> {
    return this.reservations.cancel(id);
  }
}
