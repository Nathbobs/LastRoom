import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiResponse } from '@nestjs/swagger';
import { ErrorCode } from './errors/app-exception.js';

/** Swagger-only description of the error shape. The filter builds the real body. */
class ErrorPayloadDto {
  @ApiProperty({ enum: Object.values(ErrorCode), example: 'VALIDATION_ERROR' })
  code: ErrorCode;

  @ApiProperty({ example: 'Request validation failed' })
  message: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      fields: [
        {
          field: 'checkIn',
          errors: ['checkIn must be a real date in YYYY-MM-DD format'],
        },
      ],
    },
  })
  details: Record<string, unknown>;

  @ApiProperty({ example: '3f2b9c1e-6f1d-4a57-9a39-1c1f3d7a2b10' })
  requestId: string;
}

export class ErrorResponseDto {
  @ApiProperty({ type: ErrorPayloadDto })
  error: ErrorPayloadDto;
}

const DESCRIPTIONS: Record<number, string> = {
  400: 'VALIDATION_ERROR: invalid body, query, id or date range',
  401: 'UNAUTHORIZED: missing or invalid X-Api-Key',
  404: 'NOT_FOUND: unknown id',
  409: 'ROOM_UNAVAILABLE or INVALID_STATE',
  501: 'NOT_IMPLEMENTED: lands in Phase 3',
};

/** Documents the given error statuses, all with the shared error shape. */
export function ApiErrors(
  ...statuses: number[]
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: DESCRIPTIONS[status],
        type: ErrorResponseDto,
      }),
    ),
  );
}
