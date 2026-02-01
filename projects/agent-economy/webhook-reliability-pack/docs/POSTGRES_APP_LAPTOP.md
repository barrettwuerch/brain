# Postgres.app Laptop Operations (WRP)

This guide is for running WRP on a single Mac laptop using **Postgres.app**.

If you don’t need Postgres yet, see `docs/LAPTOP_MODE.md` for the SQLite-first path.

---

## What Postgres.app is doing
- Runs Postgres locally on your Mac.
- Default host/port: `localhost:5432`
- You start/stop it from the Postgres.app UI.

WRP connects using a DSN like:

```bash
export WRP_DSN='postgres://wrp:wrp_pw@localhost:5432/wrp'
```

---

## Start / stop (daily ops)
1) Open **Postgres.app**
2) Confirm status shows **Running**

To stop: click **Stop** in the app.

**WRP behavior if Postgres is stopped:**
- workers will fail to connect and exit (or loop-error depending on your supervisor)
- deliveries will not be processed until Postgres is back

---

## “psql not found” (PATH) fix
Postgres.app ships command-line tools, but they may not be on your shell PATH.

One-off (current terminal only):
```bash
export PATH="/Applications/Postgres.app/Contents/Versions/18/bin:$PATH"
```

To make it persistent, add that line to your shell profile (e.g. `~/.zshrc`).

---

## Recommended WRP database/user setup
For WRP we use:
- database: `wrp`
- user: `wrp`
- password: `wrp_pw`

DSN:
```bash
export WRP_DSN='postgres://wrp:wrp_pw@localhost:5432/wrp'
```

Initialize WRP schema:
```bash
python3 -m wrp.cli --postgres "$WRP_DSN" init
```

---

## Health checks
Is Postgres up?
```bash
pg_isready -h localhost -p 5432
```

Is WRP connected and empty-ish?
```bash
python3 -m wrp.cli --postgres "$WRP_DSN" status
```

---

## Test database (recommended)
If you run automated tests while also running the launchd worker, use a **separate test database** so tests don’t fight the live worker.

Create:
- `wrp` (live)
- `wrp_test` (tests)

Example:
```bash
createdb wrp_test || true
psql -d postgres -c "ALTER DATABASE wrp_test OWNER TO wrp;"
psql -d wrp_test -c "ALTER SCHEMA public OWNER TO wrp;"
```

Run tests:
```bash
export WRP_TEST_DSN='postgres://wrp:wrp_pw@localhost:5432/wrp_test'
export WRP_TEST_EXCLUSIVE=1
python3 -m pytest -q
```

---

## Backups (laptop-friendly)
Postgres is not a single file like SQLite; do backups via `pg_dump`.

Create a backup:
```bash
export PATH="/Applications/Postgres.app/Contents/Versions/18/bin:$PATH"
pg_dump "$WRP_DSN" > ~/wrp/wrp_backup.sql
```

Restore (destructive to existing DB if you drop/recreate):
```bash
export PATH="/Applications/Postgres.app/Contents/Versions/18/bin:$PATH"
psql "$WRP_DSN" -f ~/wrp/wrp_backup.sql
```

**Suggested cadence:** daily or before major changes.

---

## Resetting WRP state (DANGEROUS)
If you want a clean slate for testing, you can truncate WRP tables.

This deletes delivery history.

```bash
export PATH="/Applications/Postgres.app/Contents/Versions/18/bin:$PATH"
psql "$WRP_DSN" -c "TRUNCATE attempts, deliveries, events, endpoints;"
```

If you need a safer variant, prefer making a backup first.

---

## Common issues
### permission denied for schema public
Symptoms:
- WRP init fails with `permission denied for schema public`

Fix (run as the Postgres admin user):
```bash
psql -d postgres -c "ALTER DATABASE wrp OWNER TO wrp;"
psql -d wrp -c "ALTER SCHEMA public OWNER TO wrp;"
psql -d wrp -c "GRANT ALL ON SCHEMA public TO wrp;"
```

---

## When to move beyond Postgres.app
Postgres.app is great for a laptop, but upgrade when:
- you want always-on reliability (server/VPS)
- you need automated backups
- you want multiple machines/workers

At that point, we’ll migrate to a managed Postgres or a VPS Postgres.
