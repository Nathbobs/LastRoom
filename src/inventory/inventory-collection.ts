import type { Connection } from 'mongoose';
import { INVENTORY_COLLECTION } from './inventory.schema.js';

/**
 * Database-level backstop for the invariant 0 <= booked <= total.
 *
 * MongoDB rejects ANY write that would break it (error code 121,
 * DocumentValidationFailure), no matter which code path made the write.
 * The real guarantee is still the conditional atomic update (filter on
 * `booked`); this only turns a buggy update into a loud failure instead of
 * silent overselling.
 */
export const INVENTORY_VALIDATOR = {
  $expr: {
    $and: [
      { $gte: ['$total', 0] },
      { $gte: ['$booked', 0] },
      { $lte: ['$booked', '$total'] },
    ],
  },
};

const NAMESPACE_NOT_FOUND = 26;
const NAMESPACE_EXISTS = 48;

/**
 * Applies the validator idempotently at startup.
 * - Collection exists (e.g. from an earlier run's Docker volume): collMod updates it.
 * - Collection missing: create it with the validator.
 * - Created concurrently by someone else in between: fall back to collMod.
 */
export async function ensureInventoryValidator(
  connection: Connection,
): Promise<void> {
  const db = connection.db;
  if (!db) throw new Error('MongoDB connection is not open');

  const collMod = () =>
    db.command({
      collMod: INVENTORY_COLLECTION,
      validator: INVENTORY_VALIDATOR,
      validationLevel: 'strict',
      validationAction: 'error',
    });

  try {
    await collMod();
  } catch (err) {
    if (codeOf(err) !== NAMESPACE_NOT_FOUND) throw err;
    try {
      await db.createCollection(INVENTORY_COLLECTION, {
        validator: INVENTORY_VALIDATOR,
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } catch (createErr) {
      if (codeOf(createErr) !== NAMESPACE_EXISTS) throw createErr;
      await collMod();
    }
  }
}

function codeOf(err: unknown): unknown {
  return typeof err === 'object' && err !== null
    ? (err as { code?: unknown }).code
    : undefined;
}
