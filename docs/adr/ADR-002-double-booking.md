# ADR-002: MongoDB transaction is the double-booking guarantee; Redis lock is optional

Status: accepted (Phase 3). Draft generated with Claude Code; to be rewritten by the owner.

## Context
Many requests can try to book the last unit of a room type for overlapping nights
at the same time (operator API now, channel webhook in Phase 4). A stay covers
several nights and must be booked all-or-nothing. Redis is available but may be
down; the rule is that bookings stay correct without it.

## Decision
Three layers, only the first one is load-bearing.

- **A. Guarantee (MongoDB).** One transaction per booking. For every night, in
  date order: `updateOne({ roomTypeId, date, $expr: { $lt: ['$booked', '$total'] } }, { $inc: { booked: 1 } })`.
  If a night does not match (full, or no inventory row) we throw 409
  `ROOM_UNAVAILABLE`, the transaction aborts and every night claimed so far is
  rolled back. The reservation is inserted in the same transaction. Concurrent
  writers to the same row get a WriteConflict; `connection.transaction()` retries
  them, and on retry the filter no longer matches. Cancel is the mirror
  (`$inc: -1` on every night + status flip, one transaction). A collection
  validator (`0 <= booked <= total`, Phase 2) is a second, independent backstop.
- **B. Contention reducer (Redis).** Per-room-type lease lock
  `SET lock:rt:{id} <uuid> NX PX 5000`, released with a Lua script that deletes
  only if the token still matches. Waiting requests back off for at most 3 s and
  then proceed **without** the lock. If Redis errors, skip the lock. It only
  turns a storm of WriteConflict retries into an orderly queue.
- **C. Idempotency-Key.** The key is stored on the reservation under a partial
  unique index (durable, works with Redis down) and the response is cached in
  Redis for 24 h (fast path). A key reused for a different request is 409
  `INVALID_STATE`. Failed requests are not remembered (nothing was booked).

## Alternatives rejected
- **Redis lock as the guarantee.** A lease can expire while the holder is still
  working (GC pause, slow Mongo), and a failover can lose the key; then two
  holders run at once. Correctness would depend on timing and on Redis being up.
- **Pessimistic locking (`SELECT ... FOR UPDATE`).** MongoDB has no row locks to
  hold across reads; the conditional update already locks the document for the
  write, which is all we need.
- **Optimistic version field.** Read, check, write `where version = v`. Works,
  but needs a read per night and a retry loop of our own; the conditional `$inc`
  does check-and-write in one atomic step.
- **Redis Lua counters as inventory.** Fast, but makes Redis the source of truth
  (durability, failover, drift with Mongo). Out of the question per the rules.
- **Idempotency in Redis only (as the spec first said).** If Redis is down or the
  key was evicted, a client retry would book twice. Hence the Mongo index.

## Consequences
- Requires a replica set (transactions), also in tests and Compose.
- With Redis down the system is correct but sees more WriteConflict retries
  under contention (measured: 50 parallel requests, 1 unit, Redis down: 1 x 201,
  49 x 409).
- A Mongo-path idempotent replay returns the reservation's *current* state (e.g.
  CANCELLED), while a Redis-path replay returns the original response.
- Cancel refuses (409) if inventory has drifted from the reservation, instead of
  releasing only some nights; reconciliation (Phase 5) reports such drift.
