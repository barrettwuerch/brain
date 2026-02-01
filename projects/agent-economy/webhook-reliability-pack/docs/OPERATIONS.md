# WRP Operations Guide

This document is for **operators** running Webhook Reliability Pack (WRP) in a long-lived environment.

If you’re integrating WRP into an app, see the project README. If you’re receiving webhooks, see `docs/RECEIVER_VERIFICATION.md`.

Laptop guides:
- SQLite-first: `docs/LAPTOP_MODE.md`
- Postgres.app: `docs/POSTGRES_APP_LAPTOP.md`
- Keep worker running (macOS): `docs/LAUNCHD_WORKER.md`

---

## What WRP does (operator view)
WRP is a **durable webhook dispatcher**.

- You enqueue events into a durable store.
- A worker loop claims due deliveries, sends HTTP requests, and records every attempt.
- Failures become either:
  - scheduled retries (bounded, jittered)
  - or **DLQ** (dead-letter queue) after terminal failure
- Per-endpoint **circuit breaker** prevents retry storms against unhealthy receivers.

**Semantics:** at-least-once delivery. Receivers must dedupe using `X-Event-Id` / `Idempotency-Key`.

---

## Core entities
- **Endpoint**: destination URL + secret + policy.
- **Event**: immutable payload to deliver.
- **Delivery**: (event, endpoint) + state machine.
- **Attempt**: a single HTTP request record.

---

## Delivery states (what they mean)
WRP stores a `state` per delivery:

- `pending`: eligible for delivery now or later (`next_attempt_at_ms` controls timing)
- `delivering`: currently leased/being processed by a worker
- `delivered`: succeeded (2xx)
- `dlq`: terminal failure; requires operator attention and/or replay
- `paused`: endpoint is not active; delivery won’t be attempted until endpoint is re-enabled

---

## Circuit breaker (operator behavior)
Circuit breaker is per-endpoint.

- When circuit is **open**, attempts are skipped and delivery is rescheduled for after cooldown.
- After cooldown, one **half-open probe** is allowed.
  - Success closes circuit.
  - Failure re-opens circuit with a longer cooldown.

**Operator signal:** if you see an endpoint stuck with circuit open, the receiver is likely down or rejecting requests.

---

## How to run WRP
### Backend choice (laptop-first)
- **SQLite**: recommended for your "laptop only" phase. Single machine, single file (`wrp.db`), easy backups.
- **Postgres**: recommended once you’re running multiple workers/hosts or you need stronger durability + concurrency under load.

**Rule of thumb:** If you’re not making money yet and you’re on one laptop, SQLite is the right default.

### Start a worker
WRP is currently a polling worker.

SQLite (laptop mode):
```bash
python3 -m wrp.cli --sqlite wrp.db init
python3 -m wrp.cli --sqlite wrp.db worker
```

Postgres (later):
```bash
export WRP_DSN='postgres://user:pass@host:5432/wrp'
python3 -m wrp.cli --postgres "$WRP_DSN" init
python3 -m wrp.cli --postgres "$WRP_DSN" worker
```

### Run multiple workers
You can run multiple workers against Postgres safely.

Start N processes:
```bash
python3 -m wrp.cli --postgres "$WRP_DSN" worker --worker-id wrp-1
python3 -m wrp.cli --postgres "$WRP_DSN" worker --worker-id wrp-2
# ...
```

---

## Operator workflows
### 1) Check health at a glance
SQLite:
```bash
python3 -m wrp.cli --sqlite wrp.db status
```

Postgres:
```bash
python3 -m wrp.cli --postgres "$WRP_DSN" status
```

What to look for:
- `deliveries.pending` growing continuously → workers aren’t keeping up OR receivers are unhealthy.
- `deliveries.dlq` > 0 → investigate and decide replay.
- `circuits.open` > 0 → receiver(s) likely failing.

### 2) Inspect DLQ
SQLite:
```bash
python3 -m wrp.cli --sqlite wrp.db dlq --limit 50
```

Postgres:
```bash
python3 -m wrp.cli --postgres "$WRP_DSN" dlq --limit 50
```

You’re looking for patterns:
- Same endpoint repeatedly failing → receiver config/availability issue.
- Many endpoints failing at once → network/DNS or WRP environment issue.

### 3) Replay a delivery
Replays reschedule delivery immediately (state → `pending`, `next_attempt_at_ms = now`).

SQLite:
```bash
python3 -m wrp.cli --sqlite wrp.db replay --delivery dly_...
```

Postgres:
```bash
python3 -m wrp.cli --postgres "$WRP_DSN" replay --delivery dly_...
```

**Best practice:** fix the underlying receiver issue first, then replay.

---

## Alerting recommendations (minimal)
You can start with simple checks and graduate to metrics later.

Alert if:
- DLQ count > 0 (or DLQ age > X minutes)
- pending backlog age (max `now - next_attempt_at`) exceeds threshold
- circuit open for > X minutes
- worker not running (process supervisor)

---

## Common incidents + responses
### Incident: DLQ suddenly grows
Likely causes:
- receiver returns non-retryable 4xx
- receiver auth secret mismatch (signature verification failing)
- receiver route changed (404)

Response:
1) Identify endpoint(s) in DLQ
2) Check receiver logs
3) Fix config/secret/route
4) Replay DLQ deliveries

### Incident: Circuit open, pending backlog keeps growing
Likely causes:
- receiver down or rate limiting

Response:
1) Validate receiver health
2) Consider lowering enqueue volume or adding receiver capacity
3) Let circuit protect you; replay is not helpful until receiver recovers

---

## Safety notes
- WRP is at-least-once: duplicates are expected under some failure modes.
- Do not rely on ordering.
- Treat endpoint secrets as credentials.
