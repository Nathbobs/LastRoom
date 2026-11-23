import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthReport, HealthService } from './health.service.js';

/**
 * Not behind the API-key guard (added in Phase 2): Docker and CI healthchecks
 * must be able to call it without credentials.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.health.check();
    // 503 only when Mongo is down. Redis down is "degraded" but still 200,
    // because correctness never depends on Redis.
    res.status(
      report.status === 'down' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK,
    );
    return report;
  }
}
