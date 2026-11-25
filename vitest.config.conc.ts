import { defineConfig } from 'vitest/config';

// Concurrency tests (Phase 3): same real services as the integration tests.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.conc-spec.ts'],
    // Files share one test database and wipe it between tests: run them one at a time.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 15000,
    env: {
      MONGO_URI:
        process.env.MONGO_URI ??
        'mongodb://localhost:27017/lastroom_test?directConnection=true',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      API_KEY: process.env.API_KEY ?? 'test-api-key-0123456789',
      // Only warnings and errors: 50-request races would otherwise print
      // hundreds of request lines. The logging test captures its own output.
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
      CHANNEL_SECRETS:
        process.env.CHANNEL_SECRETS ??
        'channel-a=test-channel-a-secret-0123,channel-b=test-channel-b-secret-0123',
    },
  },
});
