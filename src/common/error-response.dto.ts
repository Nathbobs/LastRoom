import { applyDecorators } from '@nestjs/common';
import {
  ApiProperty,
  ApiResponse,
  type ApiResponseExamples,
} from '@nestjs/swagger';
import { ErrorCode } from './errors/app-exception.js';

export const EXAMPLE_REQUEST_ID = '3f2b9c1e-6f1d-4a57-9a39-1c1f3d7a2b10';

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

  @ApiProperty({ example: EXAMPLE_REQUEST_ID })
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
  409: 'ROOM_UNAVAILABLE (a night is full, nothing was claimed) or INVALID_STATE (the action conflicts with the current state)',
};

/** Every response carries the request id; error bodies repeat it. */
export const REQUEST_ID_RESPONSE_HEADER = {
  'X-Request-Id': {
    description:
      'Id of this request (your X-Request-Id if it is 1-64 chars of [A-Za-z0-9._-], else a new UUID). Quote it when reporting a problem: every log line of the request carries it.',
    schema: { type: 'string', example: EXAMPLE_REQUEST_ID },
  },
};

/**
 * Real error bodies, captured from the running API, so the docs show exactly
 * what a client receives.
 */
const EXAMPLES: Record<number, Record<string, ApiResponseExamples>> = {
  400: {
    invalidField: {
      summary: 'A field fails validation',
      value: errorBody('VALIDATION_ERROR', 'Request validation failed', {
        fields: [
          {
            field: 'checkIn',
            errors: ['checkIn must be a real date in YYYY-MM-DD format'],
          },
        ],
      }),
    },
    badRange: {
      summary: 'checkOut is not after checkIn',
      value: errorBody('VALIDATION_ERROR', 'checkIn must be before checkOut', {
        checkIn: '2026-12-26',
        checkOut: '2026-12-24',
      }),
    },
    badId: {
      summary: 'Malformed id in the path',
      value: errorBody('VALIDATION_ERROR', 'Invalid id format', { id: 'abc' }),
    },
  },
  401: {
    apiKey: {
      summary: 'Missing or wrong X-Api-Key',
      value: errorBody('UNAUTHORIZED', 'Missing or invalid API key'),
    },
  },
  404: {
    roomType: {
      summary: 'Unknown room type',
      value: errorBody('NOT_FOUND', 'Room type not found', {
        roomTypeId: '6b07c8c753db61eb67136eff',
      }),
    },
    reservation: {
      summary: 'Unknown reservation',
      value: errorBody('NOT_FOUND', 'Reservation not found', {
        reservationId: '6b07c8c753db61eb67136eff',
      }),
    },
  },
  409: {
    roomUnavailable: {
      summary: 'ROOM_UNAVAILABLE: a night of the stay is full',
      value: errorBody(
        'ROOM_UNAVAILABLE',
        'No units left on 2026-12-24 for this room type',
        { roomTypeId: '6b07c8c753db61eb67136efc', night: '2026-12-24' },
      ),
    },
    alreadyCancelled: {
      summary: 'INVALID_STATE: reservation already cancelled',
      value: errorBody('INVALID_STATE', 'Reservation is already cancelled', {
        reservationId: '6b07c8cf53db61eb67136f09',
        status: 'CANCELLED',
      }),
    },
    keyReused: {
      summary: 'INVALID_STATE: Idempotency-Key reused for a different request',
      value: errorBody(
        'INVALID_STATE',
        'Idempotency-Key was already used for a different request',
        { header: 'Idempotency-Key' },
      ),
    },
  },
};

export function errorBody(
  code: ErrorCode | keyof typeof ErrorCode,
  message: string,
  details: Record<string, unknown> = {},
) {
  return { error: { code, message, details, requestId: EXAMPLE_REQUEST_ID } };
}

/** Documents the given error statuses, with the shared shape and real examples. */
export function ApiErrors(
  ...statuses: (keyof typeof DESCRIPTIONS & number)[]
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: DESCRIPTIONS[status],
        type: ErrorResponseDto,
        headers: REQUEST_ID_RESPONSE_HEADER,
        examples: EXAMPLES[status],
      }),
    ),
  );
}

/** The webhook's 401: same body for every signature failure, by design. */
export function ApiSignatureError(): MethodDecorator & ClassDecorator {
  return ApiResponse({
    status: 401,
    description:
      'INVALID_SIGNATURE: unknown channel, or missing, malformed or wrong X-Signature (deliberately indistinguishable). Nothing is recorded.',
    type: ErrorResponseDto,
    headers: REQUEST_ID_RESPONSE_HEADER,
    examples: {
      invalidSignature: {
        summary: 'Any signature failure',
        value: errorBody(
          'INVALID_SIGNATURE',
          'Missing or invalid webhook signature',
        ),
      },
    },
  });
}
