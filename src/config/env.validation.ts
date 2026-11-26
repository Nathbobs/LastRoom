/**
 * Validates environment variables once at startup so a missing or malformed
 * value fails fast with a clear message instead of surfacing later as a
 * confusing connection error.
 *
 * Hand-written on purpose (no Joi): Phase 2 brings class-validator, and this
 * can move to it then if it grows.
 */
export interface Env {
  PORT: number;
  MONGO_URI: string;
  REDIS_URL: string;
  API_KEY: string;
  /** Webhook HMAC secret per channel code, e.g. { 'channel-a': '...' }. May be empty. */
  CHANNEL_SECRETS: Record<string, string>;
  /** pino level; 'silent' turns logging off. Defaults to 'info'. */
  LOG_LEVEL: LogLevel;
}

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const MIN_API_KEY_LENGTH = 16;
const MIN_CHANNEL_SECRET_LENGTH = 16;
/** Channel codes appear in URLs and as Reservation.source. 'direct' is reserved. */
export const CHANNEL_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function validateEnv(raw: Record<string, unknown>): Env {
  const errors: string[] = [];

  const port =
    raw.PORT === undefined || raw.PORT === '' ? 3000 : Number(raw.PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    errors.push('PORT must be an integer between 1 and 65535');
  }

  const mongoUri = requireString(raw, 'MONGO_URI', errors);
  if (mongoUri && !/^mongodb(\+srv)?:\/\//.test(mongoUri)) {
    errors.push('MONGO_URI must start with mongodb:// or mongodb+srv://');
  }

  const redisUrl = requireString(raw, 'REDIS_URL', errors);
  if (redisUrl && !/^rediss?:\/\//.test(redisUrl)) {
    errors.push('REDIS_URL must start with redis:// or rediss://');
  }

  const apiKey = requireString(raw, 'API_KEY', errors);
  if (apiKey && apiKey.length < MIN_API_KEY_LENGTH) {
    // Never echo the key itself in the error.
    errors.push(`API_KEY must be at least ${MIN_API_KEY_LENGTH} characters`);
  }

  const channelSecrets = parseChannelSecrets(raw.CHANNEL_SECRETS, errors);

  const rawLevel = raw.LOG_LEVEL;
  const logLevel =
    rawLevel === undefined || rawLevel === ''
      ? 'info'
      : typeof rawLevel === 'string'
        ? rawLevel
        : '';
  if (!isLogLevel(logLevel)) {
    errors.push(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment:\n - ${errors.join('\n - ')}`);
  }

  return {
    PORT: port,
    MONGO_URI: mongoUri,
    REDIS_URL: redisUrl,
    API_KEY: apiKey,
    CHANNEL_SECRETS: channelSecrets,
    LOG_LEVEL: isLogLevel(logLevel) ? logLevel : 'info',
  };
}

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * CHANNEL_SECRETS=channel-a=<secret>,channel-b=<secret>
 * Optional: with none configured, every webhook is rejected (401).
 * Errors name the channel, never the secret.
 */
function parseChannelSecrets(
  value: unknown,
  errors: string[],
): Record<string, string> {
  const secrets: Record<string, string> = {};
  if (value === undefined || value === '') return secrets;
  if (typeof value !== 'string') {
    errors.push('CHANNEL_SECRETS must be a string');
    return secrets;
  }
  for (const entry of value.split(',')) {
    const eq = entry.indexOf('=');
    const code = (eq === -1 ? entry : entry.slice(0, eq)).trim();
    const secret = eq === -1 ? '' : entry.slice(eq + 1).trim();
    if (!CHANNEL_CODE_PATTERN.test(code) || code === 'direct') {
      errors.push(
        'CHANNEL_SECRETS: each entry must be <channel-code>=<secret> with a lowercase code (a-z, 0-9, -) other than "direct"',
      );
      continue;
    }
    if (secret.length < MIN_CHANNEL_SECRET_LENGTH) {
      errors.push(
        `CHANNEL_SECRETS: secret for "${code}" must be at least ${MIN_CHANNEL_SECRET_LENGTH} characters`,
      );
      continue;
    }
    if (code in secrets) {
      errors.push(`CHANNEL_SECRETS: "${code}" is listed twice`);
      continue;
    }
    secrets[code] = secret;
  }
  return secrets;
}

function requireString(
  raw: Record<string, unknown>,
  key: string,
  errors: string[],
): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${key} is required`);
    return '';
  }
  return value;
}
