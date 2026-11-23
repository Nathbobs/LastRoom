import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Env } from '../config/env.validation.js';
import { UnauthorizedException } from './errors/app-exception.js';

export const API_KEY_HEADER = 'x-api-key';

/** Marks a route or controller as not needing an API key (e.g. /health, and the webhook in Phase 4). */
export const Public = Reflector.createDecorator<true>({
  transform: () => true,
});

/**
 * Global guard: every route needs a valid X-Api-Key unless marked @Public().
 * Secure by default: a new controller is protected without anyone remembering to add a guard.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expectedDigest: Buffer;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    this.expectedDigest = sha256(config.get('API_KEY', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride(Public, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const provided = context
      .switchToHttp()
      .getRequest<Request>()
      .header(API_KEY_HEADER);
    // Constant-time comparison so response timing doesn't leak how much of the
    // key was right. Both sides are SHA-256 hashed first so lengths are always
    // equal (timingSafeEqual throws on different lengths, which leaks length).
    if (!provided || !timingSafeEqual(sha256(provided), this.expectedDigest)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
