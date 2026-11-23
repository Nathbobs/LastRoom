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
 * Gives every request an id: reuses an incoming X-Request-Id if it's safe,
 * otherwise generates a UUID. Echoed back in the response header and in
 * every error body, so a client report can be matched to server logs (Phase 6).
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
