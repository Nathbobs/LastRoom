import { Module, OnModuleInit } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { InventoryModule } from '../inventory/inventory.module.js';
import { RoomTypesModule } from '../room-types/room-types.module.js';
import { Reservation, ReservationSchema } from './reservation.schema.js';
import { ReservationsController } from './reservations.controller.js';
import { ReservationsService } from './reservations.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reservation.name, schema: ReservationSchema },
    ]),
    // Imported now so Phase 3 can inject InventoryService / RoomTypesService.
    InventoryModule,
    RoomTypesModule,
  ],
  controllers: [ReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule implements OnModuleInit {
  constructor(
    @InjectModel(Reservation.name)
    private readonly reservations: Model<Reservation>,
  ) {}

  /** Wait for the partial unique (source, externalId) index before serving. */
  async onModuleInit(): Promise<void> {
    await this.reservations.init();
  }
}
