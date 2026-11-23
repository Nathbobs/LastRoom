import { ValidationException } from './errors/app-exception.js';

/**
 * Nights are calendar days stored as 'YYYY-MM-DD' strings, never Date objects:
 * a night has no time or timezone. All arithmetic below is done in UTC so
 * daylight-saving and server timezone can never shift a day.
 *
 * Because the format is fixed-width and zero-padded, string comparison
 * ('2026-01-09' < '2026-01-10') is the same as date comparison.
 */

export const MAX_STAY_NIGHTS = 30;
export const MAX_RANGE_NIGHTS = 366;

const NIGHT_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** True for a well-formed, real calendar date ('2026-02-30' is false). */
export function isNight(value: unknown): value is string {
  if (typeof value !== 'string' || !NIGHT_FORMAT.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC rolls invalid dates over (Feb 30 -> Mar 2), so round-trip to detect it.
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function toUtcMs(night: string): number {
  const [y, m, d] = night.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Every night in [from, to): the end date is NOT included. */
export function expandNights(from: string, to: string): string[] {
  const nights: string[] = [];
  for (let ms = toUtcMs(from); ms < toUtcMs(to); ms += DAY_MS) {
    nights.push(fromUtcMs(ms));
  }
  return nights;
}

/**
 * Validates a date range [from, to) and returns its nights.
 * Shared by stays (max 30 nights) and operator ranges (max 366 nights).
 */
export function parseRange(
  from: string,
  to: string,
  opts: { maxNights: number; fromField?: string; toField?: string },
): string[] {
  const fromField = opts.fromField ?? 'from';
  const toField = opts.toField ?? 'to';

  for (const [field, value] of [
    [fromField, from],
    [toField, to],
  ] as const) {
    if (!isNight(value)) {
      throw new ValidationException(
        `${field} must be a real date in YYYY-MM-DD format`,
        { field, value },
      );
    }
  }
  if (from >= to) {
    throw new ValidationException(`${fromField} must be before ${toField}`, {
      [fromField]: from,
      [toField]: to,
    });
  }

  const nights = expandNights(from, to);
  if (nights.length > opts.maxNights) {
    throw new ValidationException(
      `Range is ${nights.length} nights; the maximum is ${opts.maxNights}`,
      { nights: nights.length, max: opts.maxNights },
    );
  }
  return nights;
}

/**
 * Validates a stay [checkIn, checkOut) and returns the booked nights.
 * Check-out day is not a booked night. Used by the API (Phase 3) and the
 * channel webhook (Phase 4), which doesn't go through the HTTP DTOs.
 */
export function parseStay(checkIn: string, checkOut: string): string[] {
  return parseRange(checkIn, checkOut, {
    maxNights: MAX_STAY_NIGHTS,
    fromField: 'checkIn',
    toField: 'checkOut',
  });
}
