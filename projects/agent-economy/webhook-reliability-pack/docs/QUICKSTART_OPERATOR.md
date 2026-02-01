# WRP Operator Quickstart (Mac laptop)

This is the **fastest path** to confirm WRP is working end-to-end on a Mac laptop.

Assumes:
- Postgres.app is installed and running
- WRP worker is installed as a `launchd` service (see `docs/LAUNCHD_WORKER.md`)

If you prefer SQLite-only, see `docs/LAPTOP_MODE.md`.

---

## 0) One-time: set your DSN (Postgres connection string)
```bash
export WRP_DSN='postgres://wrp:wrp_pw@localhost:5432/wrp'
```

---

## 1) Confirm Postgres is running
```bash
export PATH="/Applications/Postgres.app/Contents/Versions/18/bin:$PATH"
pg_isready -h localhost -p 5432
```
Expected: `accepting connections`

If not:
- open Postgres.app and click Start

---

## 2) Confirm the WRP worker service is running
```bash
launchctl list | grep ai.openclaw.wrp.worker
```
Expected: a line containing `ai.openclaw.wrp.worker`

Check logs:
```bash
tail -n 80 ~/wrp/wrp-worker.err.log
```

Restart worker:
```bash
launchctl stop ai.openclaw.wrp.worker
launchctl start ai.openclaw.wrp.worker
```

---

## 3) Start a local receiver (so you can see requests arrive)
In a new terminal:
```bash
export WRP_ENDPOINT_SECRET='sek'
cd /Users/bear/.openclaw/workspace/projects/agent-economy/webhook-reliability-pack
python3 tools/dev_receiver.py --port 8001
```

You should see it listening on:
`http://127.0.0.1:8001/webhook`

---

## 4) Register an endpoint + enqueue a test event
In another terminal:
```bash
cd /Users/bear/.openclaw/workspace/projects/agent-economy/webhook-reliability-pack

python3 -m wrp.cli --postgres "$WRP_DSN" add-endpoint --url http://127.0.0.1:8001/webhook --secret sek
python3 -m wrp.cli --postgres "$WRP_DSN" endpoints

python3 -m wrp.cli --postgres "$WRP_DSN" enqueue --endpoint <ep_id> --type test --payload '{"hello":"world"}'
```

Expected:
- In the receiver terminal, you see the incoming request.
- It prints `signature: OK`.

---

## 5) If nothing arrives
Check these in order:

1) Worker errors:
```bash
tail -n 200 ~/wrp/wrp-worker.err.log
```

2) Postgres is up:
```bash
pg_isready -h localhost -p 5432
```

3) Endpoint URL correctness:
- must be exactly `http://127.0.0.1:8001/webhook`
- receiver must still be running

4) Is WRP building backlog?
```bash
python3 -m wrp.cli --postgres "$WRP_DSN" status
```

---

## 6) DLQ workflow (quick)
List DLQ:
```bash
python3 -m wrp.cli --postgres "$WRP_DSN" dlq --limit 50
```
Replay a delivery after fixing receiver:
```bash
python3 -m wrp.cli --postgres "$WRP_DSN" replay --delivery dly_...
```
