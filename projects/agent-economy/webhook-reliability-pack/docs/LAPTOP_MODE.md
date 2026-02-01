# Laptop Mode (SQLite-first)

This doc is the simplest way to run WRP on a single laptop, without learning Postgres.

## Why SQLite is fine for now
- Single-machine setup
- One file DB (`wrp.db`)
- Easy backups (copy the file)

## Recommended laptop setup
1) Create a folder for WRP state
```bash
mkdir -p ~/wrp
cd ~/wrp
```

2) Install deps
```bash
cd /path/to/projects/agent-economy/webhook-reliability-pack
python3 -m pip install -r requirements.txt
```

3) Initialize DB
```bash
python3 -m wrp.cli --sqlite ~/wrp/wrp.db init
```

4) Add an endpoint
```bash
python3 -m wrp.cli --sqlite ~/wrp/wrp.db add-endpoint --url http://127.0.0.1:8001/webhook
```

5) Run the worker (keep it running)
```bash
python3 -m wrp.cli --sqlite ~/wrp/wrp.db worker
```

## Basic ops commands
```bash
python3 -m wrp.cli --sqlite ~/wrp/wrp.db status
python3 -m wrp.cli --sqlite ~/wrp/wrp.db dlq --limit 50
python3 -m wrp.cli --sqlite ~/wrp/wrp.db replay --delivery dly_...
```

## Backups
WRP state lives in the SQLite file.

- Stop the worker (or accept that the copy is a point-in-time snapshot)
- Copy the DB file somewhere safe:
```bash
cp ~/wrp/wrp.db ~/wrp/wrp.db.bak
```

## When to upgrade from SQLite to Postgres
Upgrade when:
- you need to run multiple workers on multiple machines
- your dispatch volume grows (SQLite becomes a bottleneck)
- you want stronger operational durability guarantees and easier observability

You don’t need to learn Postgres in advance; we can switch with a guided migration when it’s worth it.
