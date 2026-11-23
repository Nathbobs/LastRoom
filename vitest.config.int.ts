import { defineConfig } from 'vitest/config';

// Integration tests: run against real Mongo + Redis from `docker compose up -d mongo redis`.
// Env defaults point at the compose ports on localhost; override via the environment (e.g. in CI).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.int-spec.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    // Files share one test database and wipe it between tests: run them one at a time.
    fileParallelism: false,
    env: {
      MONGO_URI:
        process.env.MONGO_URI ??
        'mongodb://localhost:27017/lastroom_test?directConnection=true',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      API_KEY: process.env.API_KEY ?? 'test-api-key-0123456789',
    },
  },
});
