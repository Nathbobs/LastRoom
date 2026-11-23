import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsNight } from '../common/is-night.decorator.js';
import { ReservationStatus } from './reservation.schema.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class GuestDto {
  @ApiProperty({ example: 'Ada Lovelace', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiProperty({ example: 'ada@example.com', maxLength: 320 })
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email: string;
}

export class CreateReservationDto {
  @ApiProperty({ example: '6750f1c2a1b2c3d4e5f60718' })
  @IsMongoId()
  roomTypeId: string;

  @ApiProperty({
    example: '2026-12-24',
    description: 'First night (inclusive).',
  })
  @IsNight()
  checkIn: string;

  @ApiProperty({
    example: '2026-12-27',
    description:
      'Check-out day (exclusive: not a booked night). Max 30 nights.',
  })
  @IsNight()
  checkOut: string;

  @ApiProperty({ type: GuestDto })
  @ValidateNested()
  @Type(() => GuestDto)
  guest: GuestDto;
}

export class ListReservationsQueryDto {
  @ApiPropertyOptional({ example: '6750f1c2a1b2c3d4e5f60718' })
  @IsOptional()
  @IsMongoId()
  roomTypeId?: string;

  @ApiPropertyOptional({ enum: Object.values(ReservationStatus) })
  @IsOptional()
  @IsIn(Object.values(ReservationStatus))
  status?: ReservationStatus;

  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'Only stays that have a night on or after this date.',
  })
  @IsOptional()
  @IsNight()
  from?: string;

  @ApiPropertyOptional({
    example: '2027-01-01',
    description: 'Only stays that have a night before this date (exclusive).',
  })
  @IsOptional()
  @IsNight()
  to?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class GuestResponseDto {
  @ApiProperty({ example: 'Ada Lovelace' })
  name: string;

  @ApiProperty({ example: 'ada@example.com' })
  email: string;
}

export class ReservationResponseDto {
  @ApiProperty({ example: '6750f1c2a1b2c3d4e5f60719' })
  id: string;

  @ApiProperty({ example: '6750f1c2a1b2c3d4e5f60718' })
  roomTypeId: string;

  @ApiProperty({ example: '2026-12-24' })
  checkIn: string;

  @ApiProperty({ example: '2026-12-27' })
  checkOut: string;

  @ApiProperty({ example: ['2026-12-24', '2026-12-25', '2026-12-26'] })
  nights: string[];

  @ApiProperty({ type: GuestResponseDto })
  guest: GuestResponseDto;

  @ApiProperty({ enum: Object.values(ReservationStatus) })
  status: ReservationStatus;

  @ApiProperty({ example: 'direct' })
  source: string;

  @ApiPropertyOptional({ example: 'CHA-998877' })
  externalId?: string;

  @ApiProperty({ example: '2026-11-23T10:00:00.000Z' })
  createdAt: string;

  @ApiPropertyOptional({ example: '2026-11-24T09:30:00.000Z' })
  cancelledAt?: string;
}

export class ReservationListResponseDto {
  @ApiProperty({ type: ReservationResponseDto, isArray: true })
  items: ReservationResponseDto[];

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({
    example: 42,
    description: 'Total matching reservations across all pages.',
  })
  total: number;
}
