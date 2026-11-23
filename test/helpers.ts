import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../src/app.setup.js';

export const API_KEY = process.env.API_KEY ?? 'test-api-key-0123456789';

/**
 * Boots the real app (same module + setup as production) against the test database.
 * `override` can swap providers, e.g. a Redis client pointing at a dead port.
 */
export async function createTestApp(
  override: (b: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<INestApplication<App>> {
  const moduleRef = await override(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();
  const app =
    moduleRef.createNestApplication<INestApplication<App>>(APP_OPTIONS);
  configureApp(app);
  await app.init();
  return app;
}

/** Empties every collection's documents but keeps indexes and validators. */
export async function clearDatabase(app: INestApplication): Promise<void> {
  const connection = app.get<Connection>(getConnectionToken());
  const db = connection.db;
  if (!db) throw new Error('MongoDB connection is not open');
  if (!db.databaseName.endsWith('_test')) {
    throw new Error(`Refusing to clear non-test database "${db.databaseName}"`);
  }
  for (const collection of await db.collections()) {
    await collection.deleteMany({});
  }
}

/** A port nothing listens on: Redis commands fail with connection refused. */
export const DEAD_REDIS_URL = 'redis://127.0.0.1:6399';

export interface Stay {
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  guest: { name: string; email: string };
}

export function stay(roomTypeId: string, overrides: Partial<Stay> = {}): Stay {
  return {
    roomTypeId,
    checkIn: '2026-12-24',
    checkOut: '2026-12-26',
    guest: { name: 'Ada Lovelace', email: 'ada@example.com' },
    ...overrides,
  };
}

export interface RaceResult {
  status: number;
  code?: string;
  id?: string;
}

/**
 * Fires all bodies at once against a LISTENING server (a real port, so the
 * requests really run in parallel) and returns status/code per request.
 */
export async function race(
  baseUrl: string,
  bodies: object[],
  headers: Record<string, string> = {},
): Promise<RaceResult[]> {
  return Promise.all(
    bodies.map(async (body) => {
      const res = await fetch(`${baseUrl}/reservations`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': API_KEY,
          ...headers,
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        id?: string;
        error?: { code: string };
      };
      return { status: res.status, code: json.error?.code, id: json.id };
    }),
  );
}

export function tally(results: RaceResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) {
    const k = r.code ? `${r.status} ${r.code}` : String(r.status);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
