import type { DestinationStream } from 'pino';
import { pino } from 'pino';
import type { Options } from 'pino-http';
import {
  buildLoggerParams,
  REDACTED,
  requestLogLevel,
} from './logger.config.js';

function optionsOf(params: ReturnType<typeof buildLoggerParams>): Options {
  const p = params.pinoHttp;
  return (Array.isArray(p) ? p[0] : p) as Options;
}

function memoryStream() {
  const lines: Record<string, unknown>[] = [];
  const stream: DestinationStream = {
    write: (chunk: string) => {
      lines.push(JSON.parse(chunk) as Record<string, unknown>);
    },
  };
  return { stream, lines };
}

describe('buildLoggerParams', () => {
  it('uses the given level and renames reqId/responseTime', () => {
    const opts = optionsOf(buildLoggerParams('warn'));
    expect(opts.level).toBe('warn');
    expect(opts.customAttributeKeys).toEqual({
      reqId: 'requestId',
      responseTime: 'durationMs',
    });
    expect(opts.quietReqLogger).toBe(true);
  });

  it('passes a custom stream through as [options, stream]', () => {
    const { stream } = memoryStream();
    const params = buildLoggerParams('info', stream);
    expect(Array.isArray(params.pinoHttp)).toBe(true);
    expect((params.pinoHttp as unknown[])[1]).toBe(stream);
  });

  it('serializes only method/url and status code (no headers, no body)', () => {
    const opts = optionsOf(buildLoggerParams('info'));
    const req = opts.serializers!.req as (r: object) => object;
    const res = opts.serializers!.res as (r: object) => object;
    expect(
      req({
        method: 'POST',
        url: '/reservations',
        headers: { 'x-api-key': 'secret-key-0123456789' },
        body: { guest: { email: 'jane@example.com' } },
      }),
    ).toEqual({ method: 'POST', url: '/reservations' });
    expect(res({ statusCode: 201, headers: { a: 'b' } })).toEqual({
      statusCode: 201,
    });
  });

  it('redacts secret headers if a header object is ever logged', () => {
    const opts = optionsOf(buildLoggerParams('info'));
    const { stream, lines } = memoryStream();
    const logger = pino(
      { redact: opts.redact, timestamp: opts.timestamp },
      stream,
    );
    logger.info(
      {
        req: {
          headers: {
            'x-api-key': 'secret-key-0123456789',
            'x-signature': 'sha256=abc',
            authorization: 'Bearer x',
            'content-type': 'application/json',
          },
        },
      },
      'test',
    );
    const headers = (lines[0].req as { headers: Record<string, string> })
      .headers;
    expect(headers['x-api-key']).toBe(REDACTED);
    expect(headers['x-signature']).toBe(REDACTED);
    expect(headers.authorization).toBe(REDACTED);
    expect(headers['content-type']).toBe('application/json');
    expect(typeof lines[0].time).toBe('string');
  });
});

describe('requestLogLevel', () => {
  it('logs 2xx and 4xx at info, 5xx and thrown errors at error', () => {
    expect(requestLogLevel({}, { statusCode: 201 })).toBe('info');
    expect(requestLogLevel({}, { statusCode: 409 })).toBe('info');
    expect(requestLogLevel({}, { statusCode: 500 })).toBe('error');
    expect(requestLogLevel({}, { statusCode: 200 }, new Error('x'))).toBe(
      'error',
    );
  });
});
