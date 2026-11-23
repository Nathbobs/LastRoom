import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../common/error-response.dto.js';
import {
  AvailabilityQueryDto,
  AvailabilityResponseDto,
} from './availability.dto.js';
import { AvailabilityService } from './availability.service.js';

@ApiTags('availability')
@ApiSecurity('api-key')
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  @ApiOperation({
    summary: 'Per-night total / booked / available for [from, to)',
  })
  @ApiOkResponse({ type: AvailabilityResponseDto })
  @ApiErrors(400, 401, 404)
  get(@Query() q: AvailabilityQueryDto): Promise<AvailabilityResponseDto> {
    return this.availability.get(q);
  }
}
