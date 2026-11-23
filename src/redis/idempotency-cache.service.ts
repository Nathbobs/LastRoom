import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Layer C cache: Idempotency-Key -> stored JSON (24h TTL).
 *
 * Best-effort only. Every Redis error is swallowed and reported as a miss, so
 * callers must have a durable fallback (reservations keep the key in MongoDB
 * under a unique index). Values are JSON written by this app, never user input.
 */
@Injectable()
export class IdempotencyCache {
  private readonly logger = new Logger(IdempotencyCache.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(scope: string, key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.get(redisKey(scope, key));
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (err) {
      this.logger.debug(`idempotency cache read skipped: ${errMessage(err)}`);
      return undefined;
    }
  }

  async set(scope: string, key: string, value: unknown): Promise<void> {
    try {
      await this.redis.set(
        redisKey(scope, key),
        JSON.stringify(value),
        'EX',
        IDEMPOTENCY_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.debug(`idempotency cache write skipped: ${errMessage(err)}`);
    }
  }
}

export function redisKey(scope: string, key: string): string {
  return `idem:${scope}:${key}`;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
