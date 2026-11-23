import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../common/error-response.dto.js';
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
  @ApiCreatedResponse({ type: RoomTypeResponseDto })
  @ApiErrors(400, 409)
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
  @ApiOkResponse({ type: SetInventoryResponseDto })
  @ApiErrors(400, 404, 409)
  setInventory(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SetInventoryDto,
  ): Promise<SetInventoryResponseDto> {
    return this.roomTypes.setInventory(id, dto);
  }
}
