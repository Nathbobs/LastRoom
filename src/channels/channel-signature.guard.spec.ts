import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvalidSignatureException } from '../common/errors/app-exception.js';
import { ChannelSignatureGuard, signBody } from './channel-signature.guard.js';

const SECRET_A = 'secret-a-0123456789abcdef';
const SECRET_B = 'secret-b-0123456789abcdef';
const BODY = Buffer.from(
  '{"eventId":"evt_1","type":"booking.created","data":{}}',
);

const guard = new ChannelSignatureGuard({
  get: () => ({ 'channel-a': SECRET_A, 'channel-b': SECRET_B }),
} as unknown as ConfigService as never);

function ctx(
  channel: string,
  headers: Record<string, string>,
  rawBody: Buffer | null = BODY,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        params: { channel },
        rawBody: rawBody ?? undefined,
        header: (name: string) => headers[name.toLowerCase()],
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('signBody', () => {
  it('is sha256=<64 hex chars> and matches a known HMAC-SHA256 vector', () => {
    // RFC 4231 test case 2: key "Jefe", data "what do ya want for nothing?"
    expect(signBody('Jefe', 'what do ya want for nothing?')).toBe(
      'sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });
});

describe('ChannelSignatureGuard', () => {
  it('accepts a correct signature for the channel in the URL', () => {
    const sig = signBody(SECRET_A, BODY);
    expect(guard.canActivate(ctx('channel-a', { 'x-signature': sig }))).toBe(
      true,
    );
  });

  it.each([
    ['missing header', 'channel-a', {}],
    [
      'wrong prefix',
      'channel-a',
      { 'x-signature': signBody(SECRET_A, BODY).replace('sha256=', 'sha1=') },
    ],
    ['not hex', 'channel-a', { 'x-signature': `sha256=${'z'.repeat(64)}` }],
    ['too short', 'channel-a', { 'x-signature': 'sha256=abcd' }],
    [
      'uppercase hex',
      'channel-a',
      { 'x-signature': signBody(SECRET_A, BODY).toUpperCase() },
    ],
    [
      'wrong secret',
      'channel-a',
      { 'x-signature': signBody('another-secret-0123456', BODY) },
    ],
    [
      "another channel's secret",
      'channel-a',
      { 'x-signature': signBody(SECRET_B, BODY) },
    ],
    [
      'unknown channel',
      'channel-x',
      { 'x-signature': signBody(SECRET_A, BODY) },
    ],
  ])('rejects %s with INVALID_SIGNATURE', (_label, channel, headers) => {
    expect(() => guard.canActivate(ctx(channel, headers))).toThrow(
      InvalidSignatureException,
    );
  });

  it('rejects when the body was changed after signing (one byte)', () => {
    const sig = signBody(SECRET_A, BODY);
    const tampered = Buffer.from(BODY.toString().replace('evt_1', 'evt_2'));
    expect(() =>
      guard.canActivate(ctx('channel-a', { 'x-signature': sig }, tampered)),
    ).toThrow(InvalidSignatureException);
  });

  it('rejects when there is no raw body (e.g. not JSON)', () => {
    const sig = signBody(SECRET_A, BODY);
    expect(() =>
      guard.canActivate(ctx('channel-a', { 'x-signature': sig }, null)),
    ).toThrow(InvalidSignatureException);
  });
});
