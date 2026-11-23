import { validateEnv } from './env.validation.js';

const valid = {
  MONGO_URI: 'mongodb://localhost:27017/lastroom?directConnection=true',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv', () => {
  it('accepts a valid env and defaults PORT to 3000', () => {
    expect(validateEnv(valid)).toEqual({ PORT: 3000, ...valid });
  });

  it('parses PORT as a number', () => {
    expect(validateEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a missing MONGO_URI and REDIS_URL, listing both', () => {
    expect(() => validateEnv({})).toThrow(
      /MONGO_URI is required[\s\S]*REDIS_URL is required/,
    );
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
