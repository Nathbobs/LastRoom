/** MongoDB's duplicate-key error code: a unique index rejected the write. */
export const DUPLICATE_KEY = 11000;

/**
 * True if a write was rejected by a unique index. Works for single writes
 * (MongoServerError) and bulkWrite/insertMany (MongoBulkWriteError).
 */
export function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { code, writeErrors } = err as {
    code?: unknown;
    writeErrors?: unknown;
  };
  if (code === DUPLICATE_KEY) return true;
  return (
    Array.isArray(writeErrors) &&
    writeErrors.some(
      (e) => (e as { code?: unknown } | null)?.code === DUPLICATE_KEY,
    )
  );
}
