import { Injectable } from '@nestjs/common';
import { MAX_RANGE_NIGHTS, parseRange } from '../common/nights.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { RoomTypesService } from '../room-types/room-types.service.js';
import {
  AvailabilityQueryDto,
  AvailabilityResponseDto,
} from './availability.dto.js';

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly roomTypes: RoomTypesService,
    private readonly inventory: InventoryService,
  ) {}

  async get(q: AvailabilityQueryDto): Promise<AvailabilityResponseDto> {
    const nights = parseRange(q.from, q.to, { maxNights: MAX_RANGE_NIGHTS });
    await this.roomTypes.assertExists(q.roomTypeId);
    return {
      roomTypeId: q.roomTypeId,
      from: q.from,
      to: q.to,
      nights: await this.inventory.findRange(q.roomTypeId, nights),
    };
  }
}
