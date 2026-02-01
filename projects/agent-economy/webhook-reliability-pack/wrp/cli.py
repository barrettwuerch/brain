from __future__ import annotations

import argparse
import json
import os
import secrets

from .dispatcher import worker_loop
from .sqlite_store import SQLiteStorage
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


def cmd_init(args):
    st = _sqlite_store(args.sqlite)
    print(json.dumps({"ok": True, "sqlite": args.sqlite}, indent=2))


def cmd_add_endpoint(args):
    st = _sqlite_store(args.sqlite)
    secret = args.secret or secrets.token_hex(16)
    policy = {
        "max_attempts": args.max_attempts,
        "max_age_s": args.max_age_s,
        "timeout_s": args.timeout_s,
        "concurrency_limit": args.concurrency,
        "rps_limit": args.rps,
    }
    ep = st.add_endpoint(args.url, secret, policy)
    print(json.dumps({"endpoint": ep.__dict__}, indent=2))


def cmd_enqueue(args):
    st = _sqlite_store(args.sqlite)
    payload = json.loads(args.payload)
    payload.setdefault("_created_at_ms", now_ms())
    evt, dly = st.enqueue_event(args.type, payload, args.endpoint)
    print(json.dumps({"event": evt.__dict__, "delivery": dly.__dict__}, indent=2))


def cmd_worker(args):
    st = _sqlite_store(args.sqlite)
    worker_id = args.worker_id or ("wrp-" + os.urandom(4).hex())
    worker_loop(st, worker_id=worker_id)


def main():
    ap = argparse.ArgumentParser(prog="wrp")
    ap.add_argument("--sqlite", default="wrp.db")

    sub = ap.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init")
    p_init.set_defaults(fn=cmd_init)

    p_ep = sub.add_parser("add-endpoint")
    p_ep.add_argument("--url", required=True)
    p_ep.add_argument("--secret", default="")
    p_ep.add_argument("--max-attempts", type=int, default=10)
    p_ep.add_argument("--max-age-s", type=int, default=8 * 3600)
    p_ep.add_argument("--timeout-s", type=float, default=10.0)
    p_ep.add_argument("--concurrency", type=int, default=4)
    p_ep.add_argument("--rps", type=float, default=2.0)
    p_ep.set_defaults(fn=cmd_add_endpoint)

    p_enq = sub.add_parser("enqueue")
    p_enq.add_argument("--endpoint", required=True)
    p_enq.add_argument("--type", required=True)
    p_enq.add_argument("--payload", required=True)
    p_enq.set_defaults(fn=cmd_enqueue)

    p_w = sub.add_parser("worker")
    p_w.add_argument("--worker-id", default="")
    p_w.set_defaults(fn=cmd_worker)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    main()
