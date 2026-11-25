import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept a caller's id only if it's short and harmless to echo and log.
const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

/**
 * Gives a request its id, once: reuses an incoming X-Request-Id if it's safe,
 * otherwise generates a UUID. Echoed back in the response header and in every
 * error body, and used as `requestId` on every log line of the request, so a
 * client report can be matched to server logs.
 *
 * Idempotent: the middleware and the pino-http genReqId hook both call it, and
 * whichever runs first decides the id.
 */
export function resolveRequestId(req: Request, res: Response): string {
  if (req.requestId) return req.requestId;
  const incoming = req.header(REQUEST_ID_HEADER);
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  resolveRequestId(req, res);
  next();
}
