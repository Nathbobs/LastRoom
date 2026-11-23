# ADR-003: Idempotent channel webhook via a MongoDB event inbox

Status: accepted (Phase 4). Draft generated with Claude Code; to be rewritten by the owner.

## Context
Channels deliver `booking.created` / `booking.cancelled` events at least once:
the same event can arrive several times, in parallel, out of order, or after a
timeout on our side. Each must take effect exactly once, and no event may be
silently lost. Anyone can reach the URL, so deliveries must be authenticated.

## Decision
`POST /webhooks/channels/:channel`, no API key, pipeline:

1. **Signature.** `X-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>`,
   secret chosen by `:channel` (`CHANNEL_SECRETS`). Verified in a guard over the
   raw bytes (`rawBody: true`), constant-time, before validation or storage.
   Any failure (unknown channel included) is the same 401 `INVALID_SIGNATURE`.
2. **Inbox insert.** Insert `ChannelEvent { source, eventId, status: RECEIVED }`.
   The **unique `(source, eventId)` index** decides: a redelivery fails with
   E11000 and is answered `200 { status: "duplicate" }` with the original
   outcome. A bad envelope (no usable eventId) is a 400 and nothing is stored.
3. **Process** through the Phase 3 reservation service (same transaction,
   per-night conditional claim, optional Redis lock), `source = channel`,
   `externalId` from the payload.
4. **Mark** PROCESSED (with `reservationId`) or FAILED (with `error`). Failed
   events are kept forever and answered 200 `failed`, so the channel stops
   resending something that cannot succeed (full night, unknown booking, bad data).

Second line of defence: the unique partial `(source, externalId)` index on
Reservation. The same booking under a new eventId returns the existing
reservation (or FAILED `INVALID_STATE` if its details differ). Cancelling an
already-cancelled booking is a no-op.

**Retries without double effects.** Only two kinds of redelivery are processed
again, each claimed with one atomic `findOneAndUpdate` so only one wins:
a FAILED event marked `retryable` (unexpected error, answered 500 so the channel
resends) and a RECEIVED event older than 30 s (process died mid-way). This is
safe because step 3 is idempotent itself (point above).

## Alternatives rejected
- **Check-then-insert (`findOne` then `insert`).** Two parallel deliveries both
  see "not found" and both process. The unique index has no such window.
- **In-memory / Redis dedupe set.** Lost on restart, eviction or outage, and not
  shared reliably between instances. Redis is never the source of truth here.
- **Verify the signature over re-serialised JSON.** Different bytes (key order,
  whitespace) than what the channel signed: valid events would be rejected and
  the check would depend on our JSON library.
- **Return 4xx for bad booking data.** Channels retry non-2xx; a permanently bad
  event would be resent forever. Recording it as FAILED and answering 200 keeps
  it visible (reconciliation) without the retry storm.
- **Process asynchronously (queue, ack immediately).** Better latency under
  load, but needs a worker and its own failure handling. Stretch goal; the inbox
  design already supports it (RECEIVED rows are the queue).

## Consequences
- A cancel that arrives before its booking is FAILED `NOT_FOUND`; the booking is
  still applied when it arrives. Reconciliation (Phase 5) must flag this pair.
- A FAILED `ROOM_UNAVAILABLE` event is the real-world overbooking signal (the
  channel sold a unit we don't have); it is kept for reconciliation.
- If the process dies after committing the booking but before marking the
  event, the event stays RECEIVED until a redelivery after 30 s re-runs it
  (which finds the existing reservation). Without a redelivery it stays
  RECEIVED; reconciliation should report stuck events.
- The same eventId with a different body is treated as a duplicate (eventId is
  the channel's identity for the delivery); the first payload is what is stored.
