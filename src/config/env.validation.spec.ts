import { validateEnv } from './env.validation.js';

const valid = {
  MONGO_URI: 'mongodb://localhost:27017/lastroom?directConnection=true',
  REDIS_URL: 'redis://localhost:6379',
  API_KEY: 'test-api-key-0123456789',
};

describe('validateEnv', () => {
  it('accepts a valid env and defaults PORT to 3000', () => {
    expect(validateEnv(valid)).toEqual({ PORT: 3000, ...valid });
  });

  it('parses PORT as a number', () => {
    expect(validateEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects missing required vars, listing all of them', () => {
    expect(() => validateEnv({})).toThrow(
      /MONGO_URI is required[\s\S]*REDIS_URL is required[\s\S]*API_KEY is required/,
    );
  });

  it('rejects a short API_KEY without echoing it', () => {
    const run = () => validateEnv({ ...valid, API_KEY: 'shortkey' });
    expect(run).toThrow(/API_KEY must be at least 16 characters/);
    expect(run).not.toThrow(/shortkey/);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => validateEnv({ ...valid, PORT: 'abc' })).toThrow(
      /PORT must be an integer/,
    );
  });

  it('rejects URIs with the wrong scheme', () => {
    expect(() => validateEnv({ ...valid, MONGO_URI: 'http://x' })).toThrow(
      /MONGO_URI must start/,
    );
    expect(() => validateEnv({ ...valid, REDIS_URL: 'http://x' })).toThrow(
      /REDIS_URL must start/,
    );
  });
});
