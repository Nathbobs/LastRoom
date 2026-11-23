import { ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { ValidationException } from './errors/app-exception.js';

export interface FieldError {
  field: string;
  errors: string[];
}

/** Flattens class-validator's nested error tree into [{ field: 'guest.email', errors: [...] }]. */
export function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): FieldError[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own: FieldError[] = e.constraints
      ? [{ field, errors: Object.values(e.constraints) }]
      : [];
    return [...own, ...flattenValidationErrors(e.children ?? [], field)];
  });
}

/**
 * Global DTO validation.
 * - whitelist + forbidNonWhitelisted: unknown body/query fields are a 400, not silently kept.
 * - transform: query strings become DTO instances. No implicit conversion: numeric
 *   query params opt in with @Type(() => Number), so nothing is coerced by surprise.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) =>
      new ValidationException('Request validation failed', {
        fields: flattenValidationErrors(errors),
      }),
  });
}
