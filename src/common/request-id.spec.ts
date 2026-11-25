import type { Request, Response } from 'express';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id.js';

function fakeHttp(incoming?: string) {
  const headers: Record<string, string> = {};
  const req = {
    header: (name: string) =>
      name.toLowerCase() === REQUEST_ID_HEADER ? incoming : undefined,
  } as unknown as Request;
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response;
  return { req, res, headers };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('reuses a safe incoming X-Request-Id and echoes it', () => {
    const { req, res, headers } = fakeHttp('client-abc.123_x');
    expect(resolveRequestId(req, res)).toBe('client-abc.123_x');
    expect(req.requestId).toBe('client-abc.123_x');
    expect(headers[REQUEST_ID_HEADER]).toBe('client-abc.123_x');
  });

  it('generates a UUID when the header is missing', () => {
    const { req, res } = fakeHttp();
    expect(resolveRequestId(req, res)).toMatch(UUID);
  });

  it.each([
    ['too long', 'a'.repeat(65)],
    ['spaces', 'has space'],
    ['log injection', 'abc\n{"level":60}'],
    ['empty', ''],
  ])('replaces an unsafe incoming id (%s)', (_label, incoming) => {
    const { req, res } = fakeHttp(incoming);
    expect(resolveRequestId(req, res)).toMatch(UUID);
  });

  it('is idempotent: a second call keeps the first id', () => {
    const { req, res } = fakeHttp();
    const first = resolveRequestId(req, res);
    expect(resolveRequestId(req, res)).toBe(first);
  });
});
