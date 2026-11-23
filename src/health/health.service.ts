import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Redis } from 'ioredis';
// mongoose is CommonJS: under Node ESM only some names are importable as named
// exports, and `Connection`/`ConnectionStates` are not. Import the type with
// `import type` (erased at compile time) and read runtime values off the default export.
import mongoose from 'mongoose';
import type { Connection } from 'mongoose';
import { REDIS_CLIENT } from '../redis/redis.constants.js';

export type DependencyStatus = 'up' | 'down';

export interface HealthReport {
  /**
   * ok:       Mongo and Redis are both up.
   * degraded: Mongo is up but Redis is down. Bookings still work correctly,
   *           only the Redis optimisations (lock, idempotency cache) are off.
   * down:     Mongo is down. Mongo is the source of truth, so the API cannot serve.
   */
  status: 'ok' | 'degraded' | 'down';
  mongo: DependencyStatus;
  redis: DependencyStatus;
}

const PING_TIMEOUT_MS = 1000;

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly mongo: Connection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<HealthReport> {
    const [mongo, redis] = await Promise.all([
      this.checkMongo(),
      this.checkRedis(),
    ]);
    const status =
      mongo === 'down' ? 'down' : redis === 'down' ? 'degraded' : 'ok';
    return { status, mongo, redis };
  }

  private async checkMongo(): Promise<DependencyStatus> {
    const db = this.mongo.db;
    if (this.mongo.readyState !== mongoose.ConnectionStates.connected || !db) {
      return 'down';
    }
    return ping(() => db.admin().ping());
  }

  private async checkRedis(): Promise<DependencyStatus> {
    // Don't send a command we know will be rejected; status is 'ready' only
    // when the connection is fully usable.
    if (this.redis.status !== 'ready') return 'down';
    return ping(() => this.redis.ping());
  }
}

/** Runs a ping with a timeout so a hung dependency can't hang /health. */
async function ping(fn: () => Promise<unknown>): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('ping timeout')),
      PING_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([fn(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}
