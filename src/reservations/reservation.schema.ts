import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument, Types } from 'mongoose';
import { NIGHT_PATTERN } from '../inventory/inventory.schema.js';

export const ReservationStatus = {
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
} as const;
export type ReservationStatus =
  (typeof ReservationStatus)[keyof typeof ReservationStatus];

export const DIRECT_SOURCE = 'direct';

@Schema({ _id: false, versionKey: false })
export class Guest {
  @Prop({ required: true, trim: true, maxlength: 200 })
  name: string;

  @Prop({ required: true, trim: true, lowercase: true, maxlength: 320 })
  email: string;
}
const GuestSchema = SchemaFactory.createForClass(Guest);

@Schema({
  collection: 'reservations',
  versionKey: false,
  timestamps: { createdAt: true, updatedAt: false },
})
export class Reservation {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RoomType',
    required: true,
  })
  roomTypeId: Types.ObjectId;

  @Prop({ required: true, match: NIGHT_PATTERN })
  checkIn: string;

  /** Exclusive: the check-out day is not a booked night. */
  @Prop({ required: true, match: NIGHT_PATTERN })
  checkOut: string;

  /** Every booked night, [checkIn, checkOut). Stored so reconciliation (Phase 5) can count per night. */
  @Prop({ type: [String], required: true })
  nights: string[];

  @Prop({ type: GuestSchema, required: true })
  guest: Guest;

  // Explicit `type`: a union type alias can't be inferred from decorator
  // metadata (Vitest's compiler emits `Object` for it).
  @Prop({
    type: String,
    required: true,
    enum: Object.values(ReservationStatus),
    default: ReservationStatus.CONFIRMED,
  })
  status: ReservationStatus;

  /** 'direct' or a channel code, e.g. 'channel-a'. */
  @Prop({ required: true, default: DIRECT_SOURCE })
  source: string;

  /** The channel's own booking id. Absent for direct bookings. */
  @Prop()
  externalId?: string;

  createdAt: Date;

  @Prop()
  cancelledAt?: Date;
}

export type ReservationDocument = HydratedDocument<Reservation>;
export const ReservationSchema = SchemaFactory.createForClass(Reservation);

// One reservation per external booking: the same channel booking can't be
// created twice, even if it arrives under a different webhook eventId (Phase 4).
//
// PARTIAL, not sparse (the spec originally said sparse). A sparse compound index
// skips a document only if it has NONE of the indexed fields; every reservation
// has `source`, so direct bookings would all be indexed as ('direct', null) and
// the second direct booking would fail with a duplicate key. The partial filter
// indexes only documents that actually have an externalId.
ReservationSchema.index(
  { source: 1, externalId: 1 },
  {
    unique: true,
    partialFilterExpression: { externalId: { $exists: true } },
  },
);

// Serves GET /reservations filtered by room type and date window.
ReservationSchema.index({ roomTypeId: 1, checkIn: 1 });
