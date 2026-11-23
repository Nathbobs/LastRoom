import { Module, OnModuleInit } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ReservationsModule } from '../reservations/reservations.module.js';
import { ChannelEvent, ChannelEventSchema } from './channel-event.schema.js';
import { ChannelEventsService } from './channel-events.service.js';
import { ChannelSignatureGuard } from './channel-signature.guard.js';
import { ChannelsController } from './channels.controller.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChannelEvent.name, schema: ChannelEventSchema },
    ]),
    ReservationsModule,
  ],
  controllers: [ChannelsController],
  providers: [ChannelEventsService, ChannelSignatureGuard],
})
export class ChannelsModule implements OnModuleInit {
  constructor(
    @InjectModel(ChannelEvent.name)
    private readonly events: Model<ChannelEvent>,
  ) {}

  /** The unique (source, eventId) index IS the idempotency guarantee: build it before serving. */
  async onModuleInit(): Promise<void> {
    await this.events.init();
  }
}
