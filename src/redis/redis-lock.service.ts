import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';

/**
 * Deletes the lock only if it still holds OUR token. Without the check, a
 * request whose lock already expired would delete the lock another request
 * took after it, and a third request could then run alongside the second.
 */
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

export interface LockOptions {
  /** Lease length: the lock expires on its own if the holder dies. */
  ttlMs: number;
  /** How long to wait for a busy lock before going ahead without it. */
  waitMs: number;
}

export type LockOutcome = 'acquired' | 'timed-out' | 'redis-down';

/**
 * Layer B (spec section 5): a short lease lock that only REDUCES contention.
 *
 * It is never the guarantee. The guarantee is the conditional update inside the
 * MongoDB transaction (Layer A), so every path here ends by running `fn`:
 *  - lock acquired: run fn, then release with the token-checked script;
 *  - lock busy for longer than waitMs: run fn anyway (Layer A still protects);
 *  - Redis down or erroring: skip the lock and run fn.
 * A lease can expire while fn is still running (GC pause, slow Mongo); that only
 * means two requests contend in Mongo, which Layer A already handles.
 */
@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);
  private redisDown = false;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async withLock<T>(
    key: string,
    opts: LockOptions,
    fn: (outcome: LockOutcome) => Promise<T>,
  ): Promise<T> {
    const token = randomUUID();
    const outcome = await this.acquire(key, token, opts);
    try {
      return await fn(outcome);
    } finally {
      if (outcome === 'acquired') await this.release(key, token);
    }
  }

  private async acquire(
    key: string,
    token: string,
    { ttlMs, waitMs }: LockOptions,
  ): Promise<LockOutcome> {
    const deadline = Date.now() + waitMs;
    let delay = 10;
    for (;;) {
      try {
        const ok = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
        this.markRedis(true);
        if (ok === 'OK') return 'acquired';
      } catch (err) {
        this.markRedis(false, err);
        return 'redis-down';
      }
      if (Date.now() >= deadline) return 'timed-out';
      // Jittered backoff so waiting requests don't all retry at the same instant.
      await sleep(delay + Math.random() * delay);
      delay = Math.min(delay * 2, 100);
    }
  }

  private async release(key: string, token: string): Promise<void> {
    try {
      await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
    } catch (err) {
      // The lease expires on its own; nothing else to do.
      this.markRedis(false, err);
    }
  }

  /** Logs only when Redis goes down or comes back, not on every request. */
  private markRedis(up: boolean, err?: unknown): void {
    if (!up && !this.redisDown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Redis lock unavailable, continuing without it (MongoDB still guarantees correctness): ${reason}`,
      );
    } else if (up && this.redisDown) {
      this.logger.log('Redis lock available again');
    }
    this.redisDown = !up;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
