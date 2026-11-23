import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { IsNight } from '../common/is-night.decorator.js';

const MAX_UNITS = 1000;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateRoomTypeDto {
  @ApiProperty({ example: 'Deluxe Double', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: MAX_UNITS })
  @IsInt()
  @Min(1)
  @Max(MAX_UNITS)
  totalUnits: number;

  @ApiPropertyOptional({
    example: '2026-12-01',
    description:
      'Seed inventory from this night (inclusive). Give both seedFrom and seedTo, or neither.',
  })
  @IsOptional()
  @IsNight()
  seedFrom?: string;

  @ApiPropertyOptional({
    example: '2027-01-01',
    description: 'Seed inventory up to this night (exclusive), max 366 nights.',
  })
  @IsOptional()
  @IsNight()
  seedTo?: string;
}

export class SetInventoryDto {
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

  @ApiProperty({
    example: 4,
    minimum: 0,
    maximum: MAX_UNITS,
    description:
      'Sellable units per night. Rejected (409) for any night where it would drop below booked.',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_UNITS)
  total: number;
}

export class RoomTypeResponseDto {
  @ApiProperty({ example: '6750f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Deluxe Double' })
  name: string;

  @ApiProperty({ example: 5 })
  totalUnits: number;

  @ApiProperty({ example: '2026-11-23T10:00:00.000Z' })
  createdAt: string;

  @ApiPropertyOptional({
    example: 31,
    description: 'Nights seeded (create only).',
  })
  seededNights?: number;
}

export class SetInventoryResponseDto {
  @ApiProperty({ example: '6750f1c2a1b2c3d4e5f60718' })
  roomTypeId: string;

  @ApiProperty({ example: '2026-12-24' })
  from: string;

  @ApiProperty({ example: '2026-12-27' })
  to: string;

  @ApiProperty({ example: 4 })
  total: number;

  @ApiProperty({ example: 3 })
  nights: number;
}
