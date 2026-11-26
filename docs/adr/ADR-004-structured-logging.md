# ADR-004: Structured JSON logs traced by requestId

Status: accepted (Phase 6). Draft generated with Claude Code; to be rewritten by the owner.

## Context
When a guest or a channel says "my booking failed", we need to find exactly what
happened to that one request among thousands of concurrent ones, including the
lines written deep inside services (claim, lock outcome, event processing).
Logs also must not become a leak: they hold API keys, HMAC signatures and
guest emails if we are careless.

## Decision
- **nestjs-pino / pino-http**, one JSON object per line on stdout. Nest's own
  `Logger` is routed through pino (`app.useLogger`), so existing
  `new Logger(Service.name)` calls needed no new dependency injection.
- **One id per request**: `resolveRequestId()` reuses a safe incoming
  `X-Request-Id` (max 64 chars, `[A-Za-z0-9._-]`, so it can't inject log
  lines) or generates a UUID. The same id is in the response header, in every
  error body and, as `requestId`, on every log line of the request.
- **No passing ids around**: pino-http stores the request's child logger in
  AsyncLocalStorage; `quietReqLogger` makes service lines carry only
  `requestId`, not the whole request object.
- **Domain fields are JSON keys**, not text in the message: `reservationId`,
  `roomTypeId`, `eventId`, `source`, `durationMs`, plus `lock`, `code`,
  `attempt`. One `request completed` line per request with method, url,
  status and `durationMs`.
- **Levels**: 5xx and thrown errors = error; 4xx = info (a 409 on a full night
  is normal business); Redis outages = one warning on the state change, not one
  per request.
- **Privacy by construction**: request/response serializers keep only method,
  url and status, so headers and bodies are never logged. Secret header paths
  are also redacted as a second line of defence. Guest emails are logged only
  masked (`j***@example.com`). Idempotency keys and the Redis URL are not
  logged.
- `LOG_LEVEL` env var (validated). Tests run at `warn`; the logging tests
  capture the production config in memory by swapping only the destination.

## Alternatives rejected
- **Nest's ConsoleLogger with a JSON formatter**: no request context, so
  services would need the request id passed through every call.
- **Passing a request-scoped logger through DI** (`Scope.REQUEST`): makes every
  dependent provider request-scoped too, a real cost per request for the same
  result AsyncLocalStorage gives for free.
- **Logging request bodies "for debugging"**: they contain guest PII and
  channel payloads; the event inbox already stores webhook payloads durably
  where access can be controlled.
- **Warn on 4xx**: 49 warnings per last-room race would bury real problems.

## Consequences
- `docker compose logs api | grep '"requestId":"<id>"'` shows a request from
  arrival to response; `test/logging.int-spec.ts` proves it for a booking, a
  rejected booking, a webhook and a 500.
- Raw JSON is hard to read by eye in dev: pipe through `npx pino-pretty`.
- nestjs-pino keeps one pino-http instance per process (first app wins), so a
  test file that captures logs must create its apps through `LogCapture`.
- Background work outside a request (future reconciliation job) has no
  `requestId`; it will need its own correlation id (e.g. the report id).
