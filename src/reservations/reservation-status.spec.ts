import { AppException, ErrorCode } from '../common/errors/app-exception.js';
import { assertCancellable, canTransition } from './reservation-status.js';
import { ReservationStatus } from './reservation.schema.js';

const { CONFIRMED, CANCELLED } = ReservationStatus;

describe('reservation status transitions', () => {
  it.each([
    [CONFIRMED, CANCELLED, true],
    [CANCELLED, CONFIRMED, false],
    [CANCELLED, CANCELLED, false],
    [CONFIRMED, CONFIRMED, false],
  ] as const)('%s -> %s allowed: %s', (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });
});

describe('assertCancellable', () => {
  it('passes for a CONFIRMED reservation', () => {
    expect(() => assertCancellable('r1', CONFIRMED)).not.toThrow();
  });

  it('throws 409 INVALID_STATE for an already CANCELLED one', () => {
    let caught: unknown;
    try {
      assertCancellable('r1', CANCELLED);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppException);
    const err = caught as AppException;
    expect(err.status).toBe(409);
    expect(err.code).toBe(ErrorCode.INVALID_STATE);
    expect(err.message).toBe('Reservation is already cancelled');
    expect(err.details).toEqual({ reservationId: 'r1', status: CANCELLED });
  });
});
