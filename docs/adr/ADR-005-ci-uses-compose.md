# ADR-005: CI runs MongoDB and Redis from docker-compose, not GitHub `services:`

Status: accepted (Phase 7). Draft generated with Claude Code; to be rewritten by the owner.

## Context
Bookings use MongoDB transactions (ADR-002), which only work on a replica set:
`mongod --replSet rs0` plus a one-time `rs.initiate()`. CI must run the
integration and concurrency tests against a real replica set and Redis, and
the spec asks that a fresh clone + `docker compose up` + `npm run
demo:concurrency` works with no manual steps.

GitHub Actions `services:` containers accept an image, ports, env and some
`docker create` flags, but no start command, so a service Mongo starts as a
plain server and the first transaction fails.

## Decision
- The `integration` job runs `docker compose up -d --wait mongo redis`, then
  `test:int` and `test:conc`. The compose healthcheck initiates the replica set
  and only reports healthy once the node is PRIMARY; `--wait` blocks until then.
- The `e2e` job is the spec's "done when" check: a clean checkout,
  `docker compose up -d --build --wait`, then `demo:concurrency` (1 and 5 units)
  without `npm install`.
- The `check` job (format, lint, typecheck, unit, smoke) needs no services.

## Alternatives rejected
- **A third-party image that self-initialises a replica set**: a different image
  from local development, and an outside dependency to trust and track.
- **A CI-only Mongo image**: another Dockerfile to maintain.
- **`docker run ... --replSet` + an init step in YAML**: repeats in the workflow
  what the compose file already does; the two would drift.
- **mongodb-memory-server**: another dependency, and not the Mongo we ship.

## Consequences
- One definition of the infrastructure (`docker-compose.yml`) for laptop and CI:
  changing the Mongo version or replica set setup is one edit.
- CI tests what ships, including the API image (`e2e`).
- Deviates from the spec's wording ("services"), not its goal.
- Compose startup costs some seconds per job compared with service containers.
