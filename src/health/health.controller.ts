import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/api-key.guard.js';
import { HealthReport, HealthService } from './health.service.js';

/**
 * @Public: Docker and CI healthchecks must be able to call it without an API key.
 */
@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Mongo + Redis status: 200 ok/degraded, 503 when Mongo is down',
  })
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
