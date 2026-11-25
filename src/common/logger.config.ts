import type { Request, Response } from 'express';
import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { Options } from 'pino-http';
import type { LogLevel } from '../config/env.validation.js';
import { resolveRequestId } from './request-id.js';

/**
 * Header values that must never reach a log line. The request serializer below
 * already drops headers entirely; this is the second line of defence in case a
 * header object is ever logged some other way (e.g. inside an error).
 */
export const REDACTED_PATHS = [
  'req.headers["x-api-key"]',
  'req.headers["x-signature"]',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers["x-api-key"]',
  'headers["x-signature"]',
  'headers.authorization',
  'headers.cookie',
];

export const REDACTED = '[redacted]';

/** The fields the request/response serializers keep (no headers, no body). */
interface SerializedReq {
  method?: string;
  url?: string;
}
interface SerializedRes {
  statusCode?: number;
}

/**
 * nestjs-pino / pino-http settings (spec section 8):
 *
 * - One JSON object per line on stdout, ISO timestamps.
 * - Every line logged while handling a request carries `requestId`, the same
 *   id as the X-Request-Id response header and the error body. pino-http keeps
 *   the request's child logger in AsyncLocalStorage, so services get it without
 *   passing anything around.
 * - One "request completed" line per request with `durationMs`.
 * - Request bodies and headers are never logged (guest emails, API key, HMAC
 *   signature); only method, url and status code.
 *
 * `stream` lets tests capture the output in memory.
 */
export function buildLoggerParams(
  level: LogLevel,
  stream?: DestinationStream,
): Params {
  const options: Options = {
    level,
    genReqId: (req, res) =>
      resolveRequestId(req as Request, res as unknown as Response),
    customAttributeKeys: { reqId: 'requestId', responseTime: 'durationMs' },
    // Lines from services get only requestId, not the whole req object.
    quietReqLogger: true,
    customLogLevel: requestLogLevel,
    customSuccessMessage: () => 'request completed',
    customErrorMessage: () => 'request failed',
    serializers: {
      req: (req: SerializedReq) => ({ method: req.method, url: req.url }),
      res: (res: SerializedRes) => ({ statusCode: res.statusCode }),
    },
    redact: { paths: REDACTED_PATHS, censor: REDACTED },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  };
  return { pinoHttp: stream ? [options, stream] : options };
}

/**
 * 5xx (or a thrown error) is ours to fix: error. 4xx is the client's problem
 * and expected in normal operation (409 on a full night): info, not warn, so a
 * busy last-room race doesn't flood the warning level.
 */
export function requestLogLevel(
  _req: unknown,
  res: { statusCode: number },
  err?: Error,
): 'error' | 'info' {
  return err || res.statusCode >= 500 ? 'error' : 'info';
}
