import { HttpStatus } from '@nestjs/common';

/** Every error code the API can return (spec section 4, plus two operational codes). */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  NOT_FOUND: 'NOT_FOUND',
  ROOM_UNAVAILABLE: 'ROOM_UNAVAILABLE',
  INVALID_STATE: 'INVALID_STATE',
  // Not in the spec table: used by the Phase 3 stubs and for unexpected errors.
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export type ErrorDetails = Record<string, unknown>;

/**
 * Base class for every error we throw on purpose. Services throw a subclass;
 * the global filter turns it into { error: { code, message, details, requestId } }.
 * Extends Error (not Nest's HttpException) so domain code doesn't depend on HTTP.
 */
export class AppException extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: HttpStatus,
    message: string,
    readonly details: ErrorDetails = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationException extends AppException {
  constructor(message: string, details: ErrorDetails = {}) {
    super(ErrorCode.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, message, details);
  }
}

export class UnauthorizedException extends AppException {
  constructor(message = 'Missing or invalid API key') {
    super(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED, message);
  }
}

/** Webhook HMAC missing, malformed or wrong (Phase 4). Never says which part failed. */
export class InvalidSignatureException extends AppException {
  constructor(message = 'Missing or invalid webhook signature') {
    super(ErrorCode.INVALID_SIGNATURE, HttpStatus.UNAUTHORIZED, message);
  }
}

export class NotFoundException extends AppException {
  constructor(message: string, details: ErrorDetails = {}) {
    super(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, message, details);
  }
}

export class RoomUnavailableException extends AppException {
  constructor(message: string, details: ErrorDetails = {}) {
    super(ErrorCode.ROOM_UNAVAILABLE, HttpStatus.CONFLICT, message, details);
  }
}

export class InvalidStateException extends AppException {
  constructor(message: string, details: ErrorDetails = {}) {
    super(ErrorCode.INVALID_STATE, HttpStatus.CONFLICT, message, details);
  }
}

export class NotImplementedException extends AppException {
  constructor(message: string) {
    super(ErrorCode.NOT_IMPLEMENTED, HttpStatus.NOT_IMPLEMENTED, message);
  }
}
