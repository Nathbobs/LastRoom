import type { Response } from 'express';
import { HealthController } from './health.controller.js';
import type { HealthReport, HealthService } from './health.service.js';

function controllerReturning(report: HealthReport) {
  const service = {
    check: () => Promise.resolve(report),
  } as unknown as HealthService;
  return new HealthController(service);
}

function fakeRes() {
  return { status: vi.fn() } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
  };
}

describe('HealthController', () => {
  it.each([
    [{ status: 'ok', mongo: 'up', redis: 'up' }, 200],
    [{ status: 'degraded', mongo: 'up', redis: 'down' }, 200],
    [{ status: 'down', mongo: 'down', redis: 'up' }, 503],
  ] as const)('returns %o with HTTP %i', async (report, code) => {
    const res = fakeRes();
    expect(await controllerReturning(report).get(res)).toEqual(report);
    expect(res.status).toHaveBeenCalledWith(code);
  });
});
