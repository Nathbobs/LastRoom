import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { InvalidSignatureException } from '../common/errors/app-exception.js';
import type { Env } from '../config/env.validation.js';

export const SIGNATURE_HEADER = 'x-signature';
const SIGNATURE_FORMAT = /^sha256=([0-9a-f]{64})$/;

/** What a channel sends: `sha256=<hex HMAC-SHA256(secret, raw body)>`. */
export function signBody(secret: string, rawBody: Buffer | string): string {
  return `sha256=${hmac(secret, rawBody).toString('hex')}`;
}

function hmac(secret: string, rawBody: Buffer | string): Buffer {
  return createHmac('sha256', secret).update(rawBody).digest();
}

/**
 * Step 1 of the webhook pipeline (spec section 6): verify the HMAC over the RAW
 * body before anything else runs. A guard runs before pipes and the handler, so
 * a bad signature is rejected with 401 and nothing is parsed into the inbox.
 *
 * - The secret is chosen by the :channel route param, so channel A's secret
 *   can't sign events for channel B.
 * - Comparison is constant-time on two 32-byte digests.
 * - Unknown channel, missing header, bad format and wrong HMAC all get the same
 *   401, and an unknown channel still computes an HMAC (with a throwaway key),
 *   so neither the message nor the timing reveals which channels exist.
 */
@Injectable()
export class ChannelSignatureGuard implements CanActivate {
  private readonly secrets: Map<string, string>;
  private readonly decoySecret = randomBytes(32).toString('hex');

  constructor(config: ConfigService<Env, true>) {
    this.secrets = new Map(
      Object.entries(config.get('CHANNEL_SECRETS', { infer: true })),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { rawBody?: Buffer }>();
    const channel = req.params?.channel;
    const secret =
      typeof channel === 'string' ? this.secrets.get(channel) : undefined;

    const header = req.header(SIGNATURE_HEADER);
    const match =
      typeof header === 'string' ? SIGNATURE_FORMAT.exec(header) : null;
    const rawBody = req.rawBody;
    if (!match || !rawBody) throw new InvalidSignatureException();

    const expected = hmac(secret ?? this.decoySecret, rawBody);
    const provided = Buffer.from(match[1], 'hex');
    const valid = timingSafeEqual(provided, expected);
    if (!valid || secret === undefined) throw new InvalidSignatureException();
    return true;
  }
}
