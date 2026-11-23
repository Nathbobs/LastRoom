import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument, Types } from 'mongoose';

export const ChannelEventStatus = {
  RECEIVED: 'RECEIVED',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
} as const;
export type ChannelEventStatus =
  (typeof ChannelEventStatus)[keyof typeof ChannelEventStatus];

export const ChannelEventType = {
  BOOKING_CREATED: 'booking.created',
  BOOKING_CANCELLED: 'booking.cancelled',
} as const;

@Schema({ _id: false, versionKey: false })
export class ChannelEventError {
  @Prop({ required: true })
  code: string;

  @Prop({ required: true })
  message: string;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  details?: Record<string, unknown>;
}
const ChannelEventErrorSchema = SchemaFactory.createForClass(ChannelEventError);

/**
 * The webhook inbox (spec section 3 / 6). Every delivery that passes the
 * signature check is recorded here BEFORE it is processed, and kept forever,
 * FAILED ones included, so reconciliation (Phase 5) can see them.
 */
@Schema({ collection: 'channel_events', versionKey: false })
export class ChannelEvent {
  /** The channel code from the URL, e.g. 'channel-a'. */
  @Prop({ required: true })
  source: string;

  /** The channel's own id for this delivery. */
  @Prop({ required: true })
  eventId: string;

  /** Stored as sent, even if we don't support it (then the event is FAILED). */
  @Prop({ required: true })
  type: string;

  /** The parsed body (signature already verified over the raw bytes). */
  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  payload: Record<string, unknown>;

  // Explicit `type`: see Reservation.status (Vitest emits Object for unions).
  @Prop({
    type: String,
    required: true,
    enum: Object.values(ChannelEventStatus),
    default: ChannelEventStatus.RECEIVED,
  })
  status: ChannelEventStatus;

  @Prop({ type: ChannelEventErrorSchema })
  error?: ChannelEventError;

  /**
   * FAILED because of something unexpected (e.g. DB hiccup), not because of
   * the event itself. Only retryable events are reprocessed on redelivery.
   */
  @Prop({ required: true, default: false })
  retryable: boolean;

  /** How many times processing was started (1 on first delivery). */
  @Prop({ required: true, default: 1 })
  attempts: number;

  /** The reservation created or cancelled by this event. */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Reservation' })
  reservationId?: Types.ObjectId;

  @Prop({ required: true, default: () => new Date() })
  receivedAt: Date;

  /** When the current attempt started: a RECEIVED event older than the lease is stuck. */
  @Prop({ required: true, default: () => new Date() })
  processingStartedAt: Date;

  @Prop()
  processedAt?: Date;
}

export type ChannelEventDocument = HydratedDocument<ChannelEvent>;
export const ChannelEventSchema = SchemaFactory.createForClass(ChannelEvent);

// THE idempotency guarantee: a second delivery of the same event can't be
// inserted, whatever the timing, in this process or any other.
ChannelEventSchema.index({ source: 1, eventId: 1 }, { unique: true });

// For reconciliation (Phase 5): find FAILED and stuck RECEIVED events quickly.
ChannelEventSchema.index({ status: 1, receivedAt: 1 });
