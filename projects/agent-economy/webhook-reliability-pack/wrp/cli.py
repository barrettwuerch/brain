from __future__ import annotations

import argparse
import json
import os
import secrets
from typing import Any, Dict

from .dispatcher import worker_loop
from .postgres_store import PostgresStorage
from .sqlite_store import SQLiteStorage
from .storage import Storage
from .util import now_ms


def _sqlite_store(path: str) -> SQLiteStorage:
    st = SQLiteStorage(path)
    st.init_schema()
    # lightweight forward migration for existing DBs
    try:
        from .migrate_sqlite import migrate_add_circuit_columns

        with st._conn() as con:  # pylint: disable=protected-access
            migrate_add_circuit_columns(con)
    except Exception:
        pass
    return st


def _postgres_store(dsn: str) -> PostgresStorage:
    st = PostgresStorage(dsn)
    st.init_schema()
    return st


def _store(args) -> Storage:
    if args.postgres:
        return _postgres_store(args.postgres)
    return _sqlite_store(args.sqlite)


def cmd_init(args):
    _store(args)
    print(json.dumps({"ok": True, "sqlite": getattr(args, "sqlite", None), "postgres": getattr(args, "postgres", None)}, indent=2))


def cmd_add_endpoint(args):
    st = _store(args)
    secret = args.secret or secrets.token_hex(16)
    policy: Dict[str, Any] = {
        "max_attempts": args.max_attempts,
        "max_age_s": args.max_age_s,
        "timeout_s": args.timeout_s,
        "concurrency_limit": args.concurrency,
        "rps_limit": args.rps,
    }
    ep = st.add_endpoint(args.url, secret, policy)
    print(json.dumps({"endpoint": ep.__dict__}, indent=2))


def cmd_endpoints_list(args):
    st = _store(args)
    eps = [ep.__dict__ for ep in st.list_endpoints()]
    print(json.dumps({"endpoints": eps}, indent=2))


def cmd_enqueue(args):
    st = _store(args)
    payload = json.loads(args.payload)
    payload.setdefault("_created_at_ms", now_ms())
    evt, dly = st.enqueue_event(args.type, payload, args.endpoint)
    print(json.dumps({"event": evt.__dict__, "delivery": dly.__dict__}, indent=2))


def cmd_dlq_list(args):
    st = _store(args)
    dlq = [d.__dict__ for d in st.list_dlq(endpoint_id=args.endpoint, limit=args.limit)]
    print(json.dumps({"dlq": dlq}, indent=2))


def cmd_replay(args):
    st = _store(args)
    st.replay_delivery(args.delivery, now_ms=now_ms())
    d = st.get_delivery(args.delivery)
    print(json.dumps({"ok": True, "delivery": d.__dict__}, indent=2))


def cmd_status(args):
    st = _store(args)
    out: Dict[str, Any] = {"ok": True}
    if hasattr(st, "status_counts"):
        out.update(getattr(st, "status_counts")())  # type: ignore[misc]
    else:
        # portable fallback (minimal)
        out["endpoints"] = len(list(st.list_endpoints()))
        out["dlq"] = len(list(st.list_dlq(limit=10_000)))
    print(json.dumps(out, indent=2))


def cmd_worker(args):
    st = _store(args)
    worker_id = args.worker_id or ("wrp-" + os.urandom(4).hex())
    worker_loop(st, worker_id=worker_id)


def main():
    ap = argparse.ArgumentParser(prog="wrp")

    backend = ap.add_mutually_exclusive_group()
    backend.add_argument("--sqlite", default="wrp.db", help="SQLite path (dev)")
    backend.add_argument("--postgres", default="", help="Postgres DSN (recommended)")

    sub = ap.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init", help="Initialize DB schema")
    p_init.set_defaults(fn=cmd_init)

    p_ep = sub.add_parser("add-endpoint", help="Register an endpoint")
    p_ep.add_argument("--url", required=True)
    p_ep.add_argument("--secret", default="")
    p_ep.add_argument("--max-attempts", type=int, default=10)
    p_ep.add_argument("--max-age-s", type=int, default=8 * 3600)
    p_ep.add_argument("--timeout-s", type=float, default=10.0)
    p_ep.add_argument("--concurrency", type=int, default=4)
    p_ep.add_argument("--rps", type=float, default=2.0)
    p_ep.set_defaults(fn=cmd_add_endpoint)

    p_eps = sub.add_parser("endpoints", help="List endpoints")
    p_eps.set_defaults(fn=cmd_endpoints_list)

    p_enq = sub.add_parser("enqueue", help="Enqueue an event")
    p_enq.add_argument("--endpoint", required=True)
    p_enq.add_argument("--type", required=True)
    p_enq.add_argument("--payload", required=True)
    p_enq.set_defaults(fn=cmd_enqueue)

    p_dlq = sub.add_parser("dlq", help="List DLQ deliveries")
    p_dlq.add_argument("--endpoint", default="", help="Filter by endpoint id")
    p_dlq.add_argument("--limit", type=int, default=50)
    p_dlq.set_defaults(fn=cmd_dlq_list)

    p_rep = sub.add_parser("replay", help="Replay a delivery by id")
    p_rep.add_argument("--delivery", required=True)
    p_rep.set_defaults(fn=cmd_replay)

    p_stat = sub.add_parser("status", help="Show high-level counts")
    p_stat.set_defaults(fn=cmd_status)

    p_w = sub.add_parser("worker", help="Run a polling worker")
    p_w.add_argument("--worker-id", default="")
    p_w.set_defaults(fn=cmd_worker)

    args = ap.parse_args()
    if args.postgres == "":
        args.postgres = None
    return args.fn(args)


if __name__ == "__main__":
    main()
