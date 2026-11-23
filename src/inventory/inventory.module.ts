import { Module, OnModuleInit } from '@nestjs/common';
import {
  InjectConnection,
  InjectModel,
  MongooseModule,
} from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { ensureInventoryValidator } from './inventory-collection.js';
import { Inventory, InventorySchema } from './inventory.schema.js';
import { InventoryService } from './inventory.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Inventory.name, schema: InventorySchema },
    ]),
  ],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Inventory.name) private readonly inventory: Model<Inventory>,
  ) {}

  /**
   * The app doesn't start serving until the validator and the unique
   * (roomTypeId, date) index exist: the guarantees depend on them.
   */
  async onModuleInit(): Promise<void> {
    await ensureInventoryValidator(this.connection);
    await this.inventory.init();
  }
}
