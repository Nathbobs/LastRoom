# Testing

Three Vitest suites. Integration and concurrency tests run against the real
MongoDB replica set and Redis from `docker compose up -d mongo redis`.

| Command | Files | What |
|---|---|---|
| `npm test` | `src/**/*.spec.ts` | unit, no I/O |
| `npm run test:int` | `test/*.int-spec.ts` | the real app over HTTP (Supertest), one file at a time |
| `npm run test:conc` | `test/*.conc-spec.ts` | real parallel requests on a listening port |
| `npm run test:smoke` | — | builds and loads the compiled app under plain Node ESM |
| `npm run demo:concurrency` | `scripts/demo-concurrency.mjs` | the headline race against the running stack |

## Spec coverage (spec section 8)

| Level | Requirement | Where |
|---|---|---|
| Unit | night-range expansion, check-out exclusive | `src/common/nights.spec.ts` (`expandNights`, `parseStay`) |
| Unit | date validation | `src/common/nights.spec.ts` (`isNight`), `src/common/validation.spec.ts` |
| Unit | state transitions | `src/reservations/reservation-status.spec.ts` |
| Unit | HMAC verify | `src/channels/channel-signature.guard.spec.ts` (incl. RFC 4231 vector) |
| Integration | create/cancel updates inventory; cancel releases | `test/reservations.int-spec.ts` |
| Integration | multi-night stay with night 2 full: no night left claimed | `test/reservations.int-spec.ts` "partial failure: one full night in the middle leaves NO night claimed" |
| Integration | webhook replay | `test/webhooks.int-spec.ts` "replaying the same event 5 times yields exactly one reservation" |
| **Concurrency** | 50 parallel bookings for the last unit: 1 x 201, 49 x 409, `booked` = 1 | `test/reservations.conc-spec.ts`, `npm run demo:concurrency` |
| Webhook | invalid HMAC: 401 | `test/webhooks.int-spec.ts` (signature block) |
| Webhook | same eventId x5: 1 reservation | `test/webhooks.int-spec.ts`, `test/webhooks.conc-spec.ts` (x5 and x50 in parallel) |
| Webhook | cancel-before-create flagged | `test/webhooks.int-spec.ts` "a cancel that arrives BEFORE its booking is kept as FAILED NOT_FOUND" |
| Reconciliation | seeded drift detected; clean data: zero mismatches | **deferred** with Phase 5 |
| Redis-down | concurrency test again with Redis stopped: still 1 success | `test/redis-down.conc-spec.ts` (client pointed at a dead port) |
| Logging | one booking traceable by `requestId`; no secrets in logs | `test/logging.int-spec.ts` |

## Notes
- Integration files share the `lastroom_test` database and wipe it between
  tests, so they run one file at a time (`fileParallelism: false`).
- `clearDatabase()` refuses any database whose name doesn't end in `_test`.
- Suites run at `LOG_LEVEL=warn`. To see every log line of a run:
  `LOG_LEVEL=info npm run test:int`.
- Idempotency keys live in Redis for 24h across runs: tests that send one use a
  unique key per run.
