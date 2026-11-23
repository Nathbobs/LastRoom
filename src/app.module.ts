import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiKeyGuard } from './common/api-key.guard.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { createValidationPipe } from './common/validation.js';
import { Env, validateEnv } from './config/env.validation.js';
import { AvailabilityModule } from './availability/availability.module.js';
import { HealthModule } from './health/health.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { RedisModule } from './redis/redis.module.js';
import { ReservationsModule } from './reservations/reservations.module.js';
import { RoomTypesModule } from './room-types/room-types.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('MONGO_URI', { infer: true }),
        // Fail startup after 5s instead of the 30s default if Mongo is unreachable.
        serverSelectionTimeoutMS: 5000,
      }),
    }),
    RedisModule,
    HealthModule,
    InventoryModule,
    RoomTypesModule,
    AvailabilityModule,
    ReservationsModule,
  ],
  providers: [
    // Registered here (not in main.ts) so tests that import AppModule get the
    // exact same guard, validation and error shape as production.
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
