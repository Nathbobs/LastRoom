import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

export const API_KEY = process.env.API_KEY ?? 'test-api-key-0123456789';

/** Boots the real app (same module + setup as production) against the test database. */
export async function createTestApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
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
