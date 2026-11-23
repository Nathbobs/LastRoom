import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Env, validateEnv } from './config/env.validation.js';
import { HealthModule } from './health/health.module.js';
import { RedisModule } from './redis/redis.module.js';

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
  ],
})
export class AppModule {}
