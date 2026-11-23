import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.validation.js';
import { IdempotencyCache } from './idempotency-cache.service.js';
import { REDIS_CLIENT } from './redis.constants.js';
import { RedisLockService } from './redis-lock.service.js';

/**
 * Redis is an optimisation, never the source of truth (see CLAUDE.md), so the
 * client is configured to FAIL FAST when Redis is down instead of queueing or
 * retrying commands. A booking must never hang waiting for Redis.
 * Exported so tests can build a client pointing at a dead Redis.
 */
export function createRedisClient(url: string): Redis {
  const logger = new Logger('Redis');
  const client = new Redis(url, {
    // Reject commands immediately while disconnected instead of buffering them.
    enableOfflineQueue: false,
    // A command fails after one retry rather than the default 20.
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    // Keep reconnecting in the background, backing off to at most 5s.
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  // Without an 'error' listener ioredis logs unhandled errors on every
  // reconnect attempt. Log only on state changes to avoid log spam.
  let lastState: 'up' | 'down' | undefined;
  client.on('ready', () => {
    if (lastState !== 'up') logger.log('Redis connected');
    lastState = 'up';
  });
  client.on('error', (err: Error) => {
    if (lastState !== 'down') logger.warn(`Redis unavailable: ${err.message}`);
    lastState = 'down';
  });

  return client;
}

/** One shared ioredis client for the app, plus the lock and idempotency helpers. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis =>
        createRedisClient(config.get('REDIS_URL', { infer: true })),
    },
    RedisLockService,
    IdempotencyCache,
  ],
  exports: [REDIS_CLIENT, RedisLockService, IdempotencyCache],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onApplicationShutdown(): void {
    // disconnect() (not quit()) because quit() is a command, and commands are
    // rejected while offline since the offline queue is disabled.
    this.redis.disconnect();
  }
}
