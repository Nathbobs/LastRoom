import { defineConfig } from 'vitest/config';

// Concurrency tests (Phase 3): same real services as the integration tests.
// passWithNoTests only until the first *.conc-spec.ts exists; remove it in Phase 3.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.conc-spec.ts'],
    passWithNoTests: true,
    testTimeout: 30000,
    hookTimeout: 15000,
    env: {
      MONGO_URI:
        process.env.MONGO_URI ??
        'mongodb://localhost:27017/lastroom_test?directConnection=true',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      API_KEY: process.env.API_KEY ?? 'test-api-key-0123456789',
    },
  },
});
