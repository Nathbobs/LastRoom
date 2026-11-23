import { Injectable, PipeTransform } from '@nestjs/common';
import mongoose from 'mongoose';
import { ValidationException } from './errors/app-exception.js';

/**
 * Rejects malformed ids with 400 VALIDATION_ERROR before they reach Mongoose
 * (which would otherwise throw a CastError and surface as a 500).
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isObjectId(value)) {
      throw new ValidationException('Invalid id format', { id: value });
    }
    return value;
  }
}

/** Strict check: exactly 24 hex chars (mongoose.isValidObjectId also accepts any 12-char string). */
export function isObjectId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-fA-F]{24}$/.test(value) &&
    mongoose.isValidObjectId(value)
  );
}
