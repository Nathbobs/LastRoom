import { Module, OnModuleInit } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { InventoryModule } from '../inventory/inventory.module.js';
import { RoomType, RoomTypeSchema } from './room-type.schema.js';
import { RoomTypesController } from './room-types.controller.js';
import { RoomTypesService } from './room-types.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RoomType.name, schema: RoomTypeSchema },
    ]),
    InventoryModule,
  ],
  controllers: [RoomTypesController],
  providers: [RoomTypesService],
  exports: [RoomTypesService],
})
export class RoomTypesModule implements OnModuleInit {
  constructor(
    @InjectModel(RoomType.name) private readonly roomTypes: Model<RoomType>,
  ) {}

  /** Wait for the unique name index before serving. */
  async onModuleInit(): Promise<void> {
    await this.roomTypes.init();
  }
}
