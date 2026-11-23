import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard.js';
import { UnauthorizedException } from './errors/app-exception.js';

const KEY = 'correct-key-0123456789';

function guard(isPublic: boolean) {
  const reflector = {
    getAllAndOverride: () => (isPublic ? true : undefined),
  } as unknown as Reflector;
  const config = { get: () => KEY } as unknown as ConfigService;
  return new ApiKeyGuard(reflector, config as never);
}

function ctx(headers: Record<string, string>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => headers[name.toLowerCase()],
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  it('allows the correct key', () => {
    expect(guard(false).canActivate(ctx({ 'x-api-key': KEY }))).toBe(true);
  });

  it.each([
    ['missing', {}],
    ['wrong', { 'x-api-key': 'wrong-key-0123456789!!' }],
    ['a prefix of the key (different length)', { 'x-api-key': 'correct' }],
    ['empty', { 'x-api-key': '' }],
  ])('rejects a %s key with UNAUTHORIZED', (_label, headers) => {
    expect(() => guard(false).canActivate(ctx(headers))).toThrow(
      UnauthorizedException,
    );
  });

  it('lets @Public() routes through without a key', () => {
    expect(guard(true).canActivate(ctx({}))).toBe(true);
  });
});
