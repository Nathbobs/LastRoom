import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { IsNight } from '../common/is-night.decorator.js';

export class AvailabilityQueryDto {
  @ApiProperty({ example: '6750f1c2a1b2c3d4e5f60718' })
  @IsMongoId()
  roomTypeId: string;

  @ApiProperty({
    example: '2026-12-24',
    description: 'First night (inclusive).',
  })
  @IsNight()
  from: string;

  @ApiProperty({
    example: '2026-12-27',
    description: 'End night (exclusive), max 366 nights.',
  })
  @IsNight()
  to: string;
}

export class NightAvailabilityDto {
  @ApiProperty({ example: '2026-12-24' })
  date: string;

  @ApiProperty({ example: 5 })
  total: number;

  @ApiProperty({ example: 2 })
  booked: number;

  @ApiProperty({ example: 3 })
  available: number;
}

export class AvailabilityResponseDto {
  @ApiProperty({ example: '6750f1c2a1b2c3d4e5f60718' })
  roomTypeId: string;

  @ApiProperty({ example: '2026-12-24' })
  from: string;

  @ApiProperty({ example: '2026-12-27' })
  to: string;

  @ApiProperty({
    type: NightAvailabilityDto,
    isArray: true,
    description:
      'One entry per night in [from, to). Nights with no inventory row show total 0.',
  })
  nights: NightAvailabilityDto[];
}
