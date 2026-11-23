import { validateEnv } from './env.validation.js';

const valid = {
  MONGO_URI: 'mongodb://localhost:27017/lastroom?directConnection=true',
  REDIS_URL: 'redis://localhost:6379',
  API_KEY: 'test-api-key-0123456789',
};

describe('validateEnv', () => {
  it('accepts a valid env and defaults PORT to 3000', () => {
    expect(validateEnv(valid)).toEqual({
      PORT: 3000,
      ...valid,
      CHANNEL_SECRETS: {},
    });
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

  describe('CHANNEL_SECRETS', () => {
    it('parses code=secret pairs', () => {
      const env = validateEnv({
        ...valid,
        CHANNEL_SECRETS:
          'channel-a=secret-a-0123456789, channel-b=secret=with=equals',
      });
      expect(env.CHANNEL_SECRETS).toEqual({
        'channel-a': 'secret-a-0123456789',
        'channel-b': 'secret=with=equals',
      });
    });

    it('rejects a short secret without echoing it', () => {
      const run = () =>
        validateEnv({ ...valid, CHANNEL_SECRETS: 'channel-a=tooshort' });
      expect(run).toThrow(/secret for "channel-a" must be at least 16/);
      expect(run).not.toThrow(/tooshort/);
    });

    it.each([
      'Channel-A=secret-0123456789',
      'direct=secret-0123456789',
      'no-secret',
    ])('rejects a bad entry %j', (value) => {
      expect(() => validateEnv({ ...valid, CHANNEL_SECRETS: value })).toThrow(
        /CHANNEL_SECRETS/,
      );
    });

    it('rejects a duplicate channel', () => {
      expect(() =>
        validateEnv({
          ...valid,
          CHANNEL_SECRETS: 'a=secret-0123456789,a=secret-9876543210',
        }),
      ).toThrow(/"a" is listed twice/);
    });
  });
});
