import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { createRedisClient } from '../src/redis/redis.module.js';
import {
  LockOutcome,
  RedisLockService,
} from '../src/redis/redis-lock.service.js';
import { DEAD_REDIS_URL } from './helpers.js';

/** Layer B against the real Redis from docker compose (and a dead one). */
describe('RedisLockService (integration)', () => {
  let redis: Redis;
  let locks: RedisLockService;
  const opts = { ttlMs: 2000, waitMs: 1000 };
  const key = () => `lock:test:${randomUUID()}`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    redis = createRedisClient(
      process.env.REDIS_URL ?? 'redis://localhost:6379',
    );
    await new Promise((resolve) => redis.once('ready', resolve));
    locks = new RedisLockService(redis);
  });

  afterAll(() => {
    redis?.disconnect();
  });

  it('holds the lock with a TTL while fn runs and releases it after', async () => {
    const k = key();
    await locks.withLock(k, opts, async (outcome) => {
      expect(outcome).toBe('acquired');
      expect(await redis.pttl(k)).toBeGreaterThan(0);
    });
    expect(await redis.exists(k)).toBe(0);
  });

  it('releases the lock even when fn throws', async () => {
    const k = key();
    await expect(
      locks.withLock(k, opts, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(await redis.exists(k)).toBe(0);
  });

  it('serialises holders: the second waits for the first', async () => {
    const k = key();
    const order: string[] = [];
    await Promise.all([
      locks.withLock(k, opts, async () => {
        order.push('a:start');
        await sleep(100);
        order.push('a:end');
      }),
      sleep(10).then(() =>
        locks.withLock(k, opts, async (outcome) => {
          expect(outcome).toBe('acquired');
          order.push('b:start');
        }),
      ),
    ]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('goes ahead without the lock once waitMs runs out', async () => {
    const k = key();
    await redis.set(k, 'someone-else', 'PX', 5000);
    const started = Date.now();
    const outcome = await locks.withLock(k, { ttlMs: 2000, waitMs: 200 }, (o) =>
      Promise.resolve(o),
    );
    expect(outcome).toBe('timed-out');
    expect(Date.now() - started).toBeLessThan(1000);
    // It never held the lock, so it must not have deleted someone else's.
    expect(await redis.get(k)).toBe('someone-else');
  });

  it('token check: an expired holder does not delete the next holder lock', async () => {
    const k = key();
    let outcomeB: LockOutcome | undefined;
    await locks.withLock(k, { ttlMs: 100, waitMs: 0 }, async () => {
      await sleep(200); // our lease expires mid-request
      // Another request takes the now-free lock.
      outcomeB = await new Promise<LockOutcome>((resolve) => {
        void locks.withLock(k, { ttlMs: 5000, waitMs: 0 }, async (o) => {
          resolve(o);
          await sleep(300);
        });
      });
    }); // our release runs here with an outdated token
    expect(outcomeB).toBe('acquired');
    expect(await redis.exists(k)).toBe(1); // B's lock survived
  });

  it('Redis down: fn still runs, outcome redis-down, no hang', async () => {
    const dead = createRedisClient(DEAD_REDIS_URL);
    try {
      const deadLocks = new RedisLockService(dead);
      const started = Date.now();
      const result = await deadLocks.withLock(key(), opts, (o) =>
        Promise.resolve(o),
      );
      expect(result).toBe('redis-down');
      expect(Date.now() - started).toBeLessThan(500);
    } finally {
      dead.disconnect();
    }
  });
});
