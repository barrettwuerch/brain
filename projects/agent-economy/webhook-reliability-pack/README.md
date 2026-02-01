# Webhook Reliability Pack (WRP)

Implements the PRD: `projects/agent-economy/PRD_webhook_reliability_pack.md`.

Operator docs:
- `docs/OPERATIONS.md`
- `docs/LAPTOP_MODE.md` (SQLite-first)
- `docs/POSTGRES_APP_LAPTOP.md` (Mac Postgres.app)
- `docs/RECEIVER_VERIFICATION.md`
- `docs/LAUNCHD_WORKER.md` (keep the worker running on macOS)

## What it is
A drop-in webhook dispatcher providing:
- at-least-once delivery
- idempotency headers
- retries with backoff + jitter (bounded)
- per-endpoint circuit breaker
- DLQ + replay
- signed requests (HMAC + timestamp)

## Local dev
This repo ships a SQLite backend for dev and a Postgres backend as the recommended default.

## Quickstart (dev, SQLite)
```bash
python3 -m pip install -r requirements.txt
python3 -m wrp.cli --sqlite wrp.db init
python3 -m wrp.cli --sqlite wrp.db add-endpoint --url http://localhost:8001/webhook
python3 -m wrp.cli --sqlite wrp.db enqueue --endpoint <id> --type test --payload '{"hello":"world"}'
python3 -m wrp.cli --sqlite wrp.db worker
```

## Quickstart (recommended, Postgres)
```bash
export WRP_DSN='postgres://user:pass@localhost:5432/wrp'
python3 -m pip install -r requirements.txt
python3 -m wrp.cli --postgres "$WRP_DSN" init
python3 -m wrp.cli --postgres "$WRP_DSN" add-endpoint --url http://localhost:8001/webhook
python3 -m wrp.cli --postgres "$WRP_DSN" enqueue --endpoint <id> --type test --payload '{"hello":"world"}'
python3 -m wrp.cli --postgres "$WRP_DSN" worker

# ops
python3 -m wrp.cli --postgres "$WRP_DSN" endpoints
python3 -m wrp.cli --postgres "$WRP_DSN" dlq --limit 50
python3 -m wrp.cli --postgres "$WRP_DSN" replay --delivery <dly_id>
python3 -m wrp.cli --postgres "$WRP_DSN" status
```
