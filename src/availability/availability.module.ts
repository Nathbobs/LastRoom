import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { RoomTypesModule } from '../room-types/room-types.module.js';
import { AvailabilityController } from './availability.controller.js';
import { AvailabilityService } from './availability.service.js';

/** Read-only view over inventory. */
@Module({
  imports: [RoomTypesModule, InventoryModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
})
export class AvailabilityModule {}
