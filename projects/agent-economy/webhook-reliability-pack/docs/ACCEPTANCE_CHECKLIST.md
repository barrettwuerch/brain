# WRP Acceptance Checklist (operator-first)

This checklist maps the PRD gates to **operator-visible** checks.

We’ll turn these into automated tests after the ops experience is solid.

---

## Durability / crash recovery
- [ ] Enqueue returns success, then machine/worker is restarted → delivery still happens.
- [ ] Worker crashes mid-attempt → lease expires → delivery is retried (no stuck `delivering` forever).

## Retries
- [ ] Endpoint returns `500` then `200` → WRP retries with backoff+jitter and succeeds.
- [ ] Endpoint times out → WRP retries (no tight loop).
- [ ] `Retry-After` is honored for `429`.

## Signing
- [ ] Receiver verifies `X-Signature` with shared secret.
- [ ] Receiver rejects bad signature.

## DLQ + replay
- [ ] Endpoint returns a non-retryable 4xx (e.g. `410`) → delivery moves to DLQ.
- [ ] Operator can list DLQ and replay a delivery after fix.

## Circuit breaker
- [ ] Sustained failures open circuit and pause attempts.
- [ ] After cooldown, a half-open probe is attempted.
- [ ] Success closes circuit; failure reopens with longer cooldown.

---

## Suggested manual chaos setup
- local receiver: `python3 tools/dev_receiver.py`
- failure modes:
  - modify receiver to respond 500 for first N requests
  - sleep > timeout to force timeout retries
  - respond 410 to confirm DLQ behavior
