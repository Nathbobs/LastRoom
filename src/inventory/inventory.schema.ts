import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument, Types } from 'mongoose';

export const NIGHT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const INVENTORY_COLLECTION = 'inventory';

/**
 * One document per (room type, night). Availability = total - booked.
 *
 * Invariant: 0 <= booked <= total. Enforced by conditional atomic updates
 * (PUT inventory here; claim/release in Phase 3) and backstopped by a MongoDB
 * collection validator (see inventory-collection.ts). The `min` options below
 * do NOT protect `booked` on its own: Mongoose doesn't validate $inc updates.
 */
@Schema({ collection: INVENTORY_COLLECTION, versionKey: false })
export class Inventory {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RoomType',
    required: true,
  })
  roomTypeId: Types.ObjectId;

  /** The night, 'YYYY-MM-DD'. A string, not a Date: a night has no time or timezone. */
  @Prop({ required: true, match: NIGHT_PATTERN })
  date: string;

  @Prop({ required: true, min: 0 })
  total: number;

  @Prop({ required: true, min: 0, default: 0 })
  booked: number;
}

export type InventoryDocument = HydratedDocument<Inventory>;
export const InventorySchema = SchemaFactory.createForClass(Inventory);

// Unique (roomTypeId, date):
// 1. Exactly one row per night. Two rows for one night would let two bookings
//    each succeed against a different row: a double-sell.
// 2. Gives the Phase 3 claim exactly one document to conditionally update.
// 3. Serves range reads (availability, PUT inventory): equality on roomTypeId,
//    then a range scan on date, which sorts correctly as a fixed-width string.
InventorySchema.index({ roomTypeId: 1, date: 1 }, { unique: true });
