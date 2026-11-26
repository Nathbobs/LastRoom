import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiConflict, ApiErrors } from '../common/error-response.dto.js';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe.js';
import {
  CreateRoomTypeDto,
  RoomTypeResponseDto,
  SetInventoryDto,
  SetInventoryResponseDto,
} from './room-types.dto.js';
import { RoomTypesService } from './room-types.service.js';

@ApiTags('room-types')
@ApiSecurity('api-key')
@ApiErrors(401)
@Controller('room-types')
export class RoomTypesController {
  constructor(private readonly roomTypes: RoomTypesService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a room type, optionally seeding inventory for [seedFrom, seedTo)',
  })
  @ApiBody({
    type: CreateRoomTypeDto,
    examples: {
      seeded: {
        summary: 'With inventory for Dec 24-30 (seedTo is exclusive)',
        value: {
          name: 'Deluxe Double',
          totalUnits: 4,
          seedFrom: '2026-12-24',
          seedTo: '2026-12-31',
        },
      },
      bare: {
        summary: 'No inventory yet (set it later with PUT .../inventory)',
        value: { name: 'Family Suite', totalUnits: 2 },
      },
    },
  })
  @ApiCreatedResponse({ type: RoomTypeResponseDto })
  @ApiErrors(400)
  @ApiConflict('nameTaken')
  create(@Body() dto: CreateRoomTypeDto): Promise<RoomTypeResponseDto> {
    return this.roomTypes.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List room types' })
  @ApiOkResponse({ type: RoomTypeResponseDto, isArray: true })
  list(): Promise<RoomTypeResponseDto[]> {
    return this.roomTypes.list();
  }

  @Put(':id/inventory')
  @ApiOperation({
    summary: 'Set total units per night for [from, to); creates missing nights',
    description:
      'All-or-nothing: 409 INVALID_STATE (listing the nights) if any night already has more units booked than the new total.',
  })
  @ApiBody({
    type: SetInventoryDto,
    examples: {
      raise: {
        summary: 'Open a fifth unit for Christmas week',
        value: { from: '2026-12-24', to: '2026-12-31', total: 5 },
      },
      close: {
        summary: 'Stop selling (fails with 409 if anything is booked)',
        value: { from: '2026-12-24', to: '2026-12-26', total: 0 },
      },
    },
  })
  @ApiOkResponse({ type: SetInventoryResponseDto })
  @ApiErrors(400, 404)
  @ApiConflict('belowBooked')
  setInventory(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SetInventoryDto,
  ): Promise<SetInventoryResponseDto> {
    return this.roomTypes.setInventory(id, dto);
  }
}
