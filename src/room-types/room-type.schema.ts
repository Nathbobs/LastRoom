import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** A category of identical units, e.g. "Deluxe Double" x 5. We sell units, not named rooms. */
@Schema({
  collection: 'room_types',
  timestamps: { createdAt: true, updatedAt: false },
})
export class RoomType {
  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  /** Default per-night `total` used when seeding inventory. Per-night totals can differ later. */
  @Prop({ required: true, min: 1 })
  totalUnits: number;

  createdAt: Date;
}

export type RoomTypeDocument = HydratedDocument<RoomType>;
export const RoomTypeSchema = SchemaFactory.createForClass(RoomType);

// Unique name: creating "Deluxe Double" twice would split one room type's
// inventory across two ids. (Not in the spec; added in Phase 2.)
RoomTypeSchema.index({ name: 1 }, { unique: true });
