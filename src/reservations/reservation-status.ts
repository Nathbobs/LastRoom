import { InvalidStateException } from '../common/errors/app-exception.js';
import { ReservationStatus } from './reservation.schema.js';

/**
 * Allowed status changes. A reservation is born CONFIRMED and can only move to
 * CANCELLED; CANCELLED is final (no un-cancel: rebook instead, so the nights
 * are claimed again through the normal all-or-nothing path).
 */
const TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  [ReservationStatus.CONFIRMED]: [ReservationStatus.CANCELLED],
  [ReservationStatus.CANCELLED]: [],
};

export function canTransition(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** 409 INVALID_STATE unless the reservation may be cancelled. */
export function assertCancellable(
  reservationId: string,
  status: ReservationStatus,
): void {
  if (!canTransition(status, ReservationStatus.CANCELLED)) {
    throw new InvalidStateException(
      status === ReservationStatus.CANCELLED
        ? 'Reservation is already cancelled'
        : `Reservation in status ${status} cannot be cancelled`,
      { reservationId, status },
    );
  }
}
