import type { Redis } from 'ioredis';
import mongoose from 'mongoose';
import type { Connection } from 'mongoose';
import { HealthService } from './health.service.js';

const { ConnectionStates } = mongoose;

function fakeMongo(opts: {
  connected: boolean;
  ping?: () => Promise<unknown>;
}) {
  return {
    readyState: opts.connected
      ? ConnectionStates.connected
      : ConnectionStates.disconnected,
    db: {
      admin: () => ({ ping: opts.ping ?? (() => Promise.resolve({ ok: 1 })) }),
    },
  } as unknown as Connection;
}

function fakeRedis(opts: { status: string; ping?: () => Promise<unknown> }) {
  return {
    status: opts.status,
    ping: opts.ping ?? (() => Promise.resolve('PONG')),
  } as unknown as Redis;
}

describe('HealthService', () => {
  it('is ok when Mongo and Redis are up', async () => {
    const svc = new HealthService(
      fakeMongo({ connected: true }),
      fakeRedis({ status: 'ready' }),
    );
    expect(await svc.check()).toEqual({
      status: 'ok',
      mongo: 'up',
      redis: 'up',
    });
  });

  it('is degraded (not down) when only Redis is down', async () => {
    const ping = vi.fn(() => Promise.resolve('PONG'));
    const svc = new HealthService(
      fakeMongo({ connected: true }),
      fakeRedis({ status: 'reconnecting', ping }),
    );
    expect(await svc.check()).toEqual({
      status: 'degraded',
      mongo: 'up',
      redis: 'down',
    });
    // Doesn't send a command it knows will be rejected.
    expect(ping).not.toHaveBeenCalled();
  });

  it('is down when Mongo is disconnected, even if Redis is up', async () => {
    const svc = new HealthService(
      fakeMongo({ connected: false }),
      fakeRedis({ status: 'ready' }),
    );
    expect(await svc.check()).toEqual({
      status: 'down',
      mongo: 'down',
      redis: 'up',
    });
  });

  it('treats a failing ping as down', async () => {
    const svc = new HealthService(
      fakeMongo({
        connected: true,
        ping: () => Promise.reject(new Error('boom')),
      }),
      fakeRedis({
        status: 'ready',
        ping: () => Promise.reject(new Error('boom')),
      }),
    );
    expect(await svc.check()).toEqual({
      status: 'down',
      mongo: 'down',
      redis: 'down',
    });
  });

  it('treats a hung ping as down after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const never = () => new Promise(() => {});
      const svc = new HealthService(
        fakeMongo({ connected: true }),
        fakeRedis({ status: 'ready', ping: never }),
      );
      const result = svc.check();
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toEqual({
        status: 'degraded',
        mongo: 'up',
        redis: 'down',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
