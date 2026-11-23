import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException as NestNotFound,
} from '@nestjs/common';
import { AllExceptionsFilter, mapException } from './all-exceptions.filter.js';
import {
  InvalidStateException,
  InvalidSignatureException,
  NotImplementedException,
  RoomUnavailableException,
  ValidationException,
} from './app-exception.js';

function fakeHost(requestId = 'req-1') {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ requestId, method: 'GET', path: '/x' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('mapException', () => {
  it.each([
    [new ValidationException('bad', { a: 1 }), 400, 'VALIDATION_ERROR'],
    [new RoomUnavailableException('full'), 409, 'ROOM_UNAVAILABLE'],
    [new InvalidStateException('nope'), 409, 'INVALID_STATE'],
    [new NotImplementedException('later'), 501, 'NOT_IMPLEMENTED'],
    [new InvalidSignatureException(), 401, 'INVALID_SIGNATURE'],
  ] as const)('maps %o to %i %s', (err, status, code) => {
    expect(mapException(err)).toMatchObject({ status, code });
  });

  it('maps Nest HTTP errors (unknown route, malformed JSON) to spec codes', () => {
    expect(mapException(new NestNotFound('Cannot GET /nope'))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(
      mapException(new BadRequestException('Unexpected token')),
    ).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('hides unexpected errors behind a generic 500', () => {
    expect(mapException(new Error('db password is hunter2'))).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    });
  });
});

describe('AllExceptionsFilter', () => {
  it('writes the spec error shape with the request id', () => {
    const { host, status, json } = fakeHost('abc-123');
    new AllExceptionsFilter().catch(
      new RoomUnavailableException('No units left', { nights: ['2026-12-24'] }),
      host,
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'ROOM_UNAVAILABLE',
        message: 'No units left',
        details: { nights: ['2026-12-24'] },
        requestId: 'abc-123',
      },
    });
  });
});
