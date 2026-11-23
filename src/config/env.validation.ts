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
}

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

  if (errors.length > 0) {
    throw new Error(`Invalid environment:\n - ${errors.join('\n - ')}`);
  }

  return { PORT: port, MONGO_URI: mongoUri, REDIS_URL: redisUrl };
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
