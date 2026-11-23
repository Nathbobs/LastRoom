import {
  InvalidStateException,
  ValidationException,
} from '../common/errors/app-exception.js';

/** Visible ASCII only (no spaces or control chars), like Stripe's keys. */
const KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;

/** The parts of a create request that must match for a retry to be a replay. */
export interface StayRequest {
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  guest: { name: string; email: string };
}

/** Returns the key if valid, undefined if absent; throws 400 if malformed. */
export function parseIdempotencyKey(
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  if (!KEY_PATTERN.test(raw)) {
    throw new ValidationException(
      'Idempotency-Key must be 1-255 visible ASCII characters',
      { header: 'Idempotency-Key' },
    );
  }
  return raw;
}

/** Normalises the way the database does (trimmed name, lowercased email). */
function normalise(r: StayRequest): StayRequest {
  return {
    roomTypeId: r.roomTypeId.toLowerCase(),
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    guest: {
      name: r.guest.name.trim(),
      email: r.guest.email.trim().toLowerCase(),
    },
  };
}

export function isSameRequest(a: StayRequest, b: StayRequest): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

/**
 * A key reused for a DIFFERENT request is a client bug: replaying the old
 * response would hide it, and booking again would break the key's promise.
 */
export function assertSameRequest(
  incoming: StayRequest,
  original: StayRequest,
): void {
  if (!isSameRequest(incoming, original)) {
    throw new InvalidStateException(
      'Idempotency-Key was already used for a different request',
      { header: 'Idempotency-Key' },
    );
  }
}
