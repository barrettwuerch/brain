from __future__ import annotations

import json
import sqlite3
from typing import Any, Dict, Iterable, Optional, Tuple

from .model import Attempt, Delivery, Endpoint, Event
from .storage import Storage
from .util import gen_id


class SQLiteStorage(Storage):
    def __init__(self, path: str):
        self.path = path

    def _conn(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.path)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA foreign_keys=ON")
        return con

    def init_schema(self) -> None:
        with self._conn() as con:
            con.executescript(
                """
                CREATE TABLE IF NOT EXISTS endpoints (
                  id TEXT PRIMARY KEY,
                  url TEXT NOT NULL,
                  secret TEXT NOT NULL,
                  status TEXT NOT NULL,
                  policy_json TEXT NOT NULL,
                  circuit_state TEXT NOT NULL DEFAULT 'closed',
                  circuit_opened_at_ms INTEGER,
                  circuit_cooldown_ms INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS events (
                  id TEXT PRIMARY KEY,
                  type TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  created_at_ms INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS deliveries (
                  id TEXT PRIMARY KEY,
                  event_id TEXT NOT NULL REFERENCES events(id),
                  endpoint_id TEXT NOT NULL REFERENCES endpoints(id),
                  state TEXT NOT NULL,
                  attempt_count INTEGER NOT NULL,
                  next_attempt_at_ms INTEGER NOT NULL,
                  last_error TEXT,
                  lease_owner TEXT,
                  lease_expires_at_ms INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_deliveries_due ON deliveries(next_attempt_at_ms);
                CREATE INDEX IF NOT EXISTS idx_deliveries_endpoint ON deliveries(endpoint_id);

                CREATE TABLE IF NOT EXISTS attempts (
                  id TEXT PRIMARY KEY,
                  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
                  attempt_no INTEGER NOT NULL,
                  ts_ms INTEGER NOT NULL,
                  http_status INTEGER,
                  error TEXT,
                  latency_ms INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_attempts_delivery ON attempts(delivery_id);
                """
            )

    def add_endpoint(self, url: str, secret: str, policy: Dict[str, Any]) -> Endpoint:
        endpoint_id = gen_id("ep")
        with self._conn() as con:
            con.execute(
                "INSERT INTO endpoints(id,url,secret,status,policy_json) VALUES (?,?,?,?,?)",
                (endpoint_id, url, secret, "active", json.dumps(policy)),
            )
        return self.get_endpoint(endpoint_id)

    def get_endpoint(self, endpoint_id: str) -> Endpoint:
        with self._conn() as con:
            row = con.execute("SELECT * FROM endpoints WHERE id=?", (endpoint_id,)).fetchone()
            if not row:
                raise KeyError(f"endpoint not found: {endpoint_id}")
            policy = json.loads(row["policy_json"])
            policy.setdefault(
                "circuit",
                {
                    "state": row["circuit_state"],
                    "opened_at_ms": row["circuit_opened_at_ms"],
                    "cooldown_ms": row["circuit_cooldown_ms"],
                },
            )
            return Endpoint(
                id=row["id"],
                url=row["url"],
                secret=row["secret"],
                status=row["status"],
                policy=policy,
            )

    def list_endpoints(self) -> Iterable[Endpoint]:
        with self._conn() as con:
            rows = con.execute("SELECT id FROM endpoints ORDER BY id").fetchall()
        for r in rows:
            yield self.get_endpoint(r["id"])

    def enqueue_event(self, event_type: str, payload: Dict[str, Any], endpoint_id: str) -> Tuple[Event, Delivery]:
        event_id = gen_id("evt")
        delivery_id = gen_id("dly")
        created_at_ms = payload.get("_created_at_ms")
        if not isinstance(created_at_ms, int):
            created_at_ms = None
        # caller sets timestamps; if not present, use now at enqueue time
        if created_at_ms is None:
            import time

            created_at_ms = int(time.time() * 1000)

        with self._conn() as con:
            con.execute(
                "INSERT INTO events(id,type,payload_json,created_at_ms) VALUES (?,?,?,?)",
                (event_id, event_type, json.dumps(payload), created_at_ms),
            )
            con.execute(
                "INSERT INTO deliveries(id,event_id,endpoint_id,state,attempt_count,next_attempt_at_ms,last_error,lease_owner,lease_expires_at_ms) VALUES (?,?,?,?,?,?,?,?,?)",
                (delivery_id, event_id, endpoint_id, "pending", 0, created_at_ms, None, None, None),
            )

        return (
            Event(id=event_id, type=event_type, payload=payload, created_at_ms=created_at_ms),
            self.get_delivery(delivery_id),
        )

    def get_event(self, event_id: str) -> Event:
        with self._conn() as con:
            row = con.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
            if not row:
                raise KeyError(f"event not found: {event_id}")
            payload = json.loads(row["payload_json"])
            return Event(id=row["id"], type=row["type"], payload=payload, created_at_ms=row["created_at_ms"])

    def get_delivery(self, delivery_id: str) -> Delivery:
        with self._conn() as con:
            row = con.execute("SELECT * FROM deliveries WHERE id=?", (delivery_id,)).fetchone()
            if not row:
                raise KeyError(f"delivery not found: {delivery_id}")
            return Delivery(
                id=row["id"],
                event_id=row["event_id"],
                endpoint_id=row["endpoint_id"],
                state=row["state"],
                attempt_count=row["attempt_count"],
                next_attempt_at_ms=row["next_attempt_at_ms"],
                last_error=row["last_error"],
                lease_owner=row["lease_owner"],
                lease_expires_at_ms=row["lease_expires_at_ms"],
            )

    def list_dlq(self, endpoint_id: Optional[str] = None, limit: int = 50) -> Iterable[Delivery]:
        q = "SELECT id FROM deliveries WHERE state='dlq'"
        params = []
        if endpoint_id:
            q += " AND endpoint_id=?"
            params.append(endpoint_id)
        q += " ORDER BY next_attempt_at_ms DESC LIMIT ?"
        params.append(limit)
        with self._conn() as con:
            rows = con.execute(q, tuple(params)).fetchall()
        for r in rows:
            yield self.get_delivery(r["id"])

    def replay_delivery(self, delivery_id: str, now_ms: int) -> None:
        with self._conn() as con:
            con.execute(
                "UPDATE deliveries SET state='pending', next_attempt_at_ms=?, last_error=NULL WHERE id=?",
                (now_ms, delivery_id),
            )

    def record_attempt(self, delivery_id: str, attempt_no: int, ts_ms: int, http_status: Optional[int], error: Optional[str], latency_ms: Optional[int]) -> Attempt:
        attempt_id = gen_id("att")
        with self._conn() as con:
            con.execute(
                "INSERT INTO attempts(id,delivery_id,attempt_no,ts_ms,http_status,error,latency_ms) VALUES (?,?,?,?,?,?,?)",
                (attempt_id, delivery_id, attempt_no, ts_ms, http_status, error, latency_ms),
            )
        return Attempt(
            id=attempt_id,
            delivery_id=delivery_id,
            attempt_no=attempt_no,
            ts_ms=ts_ms,
            http_status=http_status,
            error=error,
            latency_ms=latency_ms,
        )

    def mark_delivery_state(self, delivery_id: str, *, state: str, attempt_count: int, next_attempt_at_ms: int, last_error: Optional[str]) -> None:
        with self._conn() as con:
            con.execute(
                "UPDATE deliveries SET state=?, attempt_count=?, next_attempt_at_ms=?, last_error=? WHERE id=?",
                (state, attempt_count, next_attempt_at_ms, last_error, delivery_id),
            )

    def claim_next_delivery(self, *, now_ms: int, worker_id: str, lease_ms: int) -> Optional[Delivery]:
        lease_exp = now_ms + lease_ms
        with self._conn() as con:
            con.execute("BEGIN IMMEDIATE")
            row = con.execute(
                """
                SELECT id FROM deliveries
                WHERE state IN ('pending','delivering')
                  AND next_attempt_at_ms <= ?
                  AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)
                ORDER BY next_attempt_at_ms ASC
                LIMIT 1
                """,
                (now_ms, now_ms),
            ).fetchone()
            if not row:
                con.execute("COMMIT")
                return None
            delivery_id = row["id"]
            con.execute(
                "UPDATE deliveries SET lease_owner=?, lease_expires_at_ms=?, state='delivering' WHERE id=?",
                (worker_id, lease_exp, delivery_id),
            )
            con.execute("COMMIT")
        return self.get_delivery(delivery_id)

    def release_lease(self, delivery_id: str, worker_id: str) -> None:
        with self._conn() as con:
            con.execute(
                "UPDATE deliveries SET lease_owner=NULL, lease_expires_at_ms=NULL WHERE id=? AND lease_owner=?",
                (delivery_id, worker_id),
            )

    def endpoint_failure_stats(self, endpoint_id: str, *, window_ms: int, now_ms: int) -> Tuple[int, int, int]:
        start = now_ms - window_ms
        with self._conn() as con:
            attempts = con.execute(
                """
                SELECT a.http_status, a.error
                FROM attempts a
                JOIN deliveries d ON d.id=a.delivery_id
                WHERE d.endpoint_id=? AND a.ts_ms >= ?
                """,
                (endpoint_id, start),
            ).fetchall()
            total = len(attempts)
            failures = 0
            for r in attempts:
                status = r["http_status"]
                err = r["error"]
                if err is not None:
                    failures += 1
                elif status is None:
                    failures += 1
                elif status >= 400:
                    failures += 1

            # consecutive failures from most recent attempts
            recent = con.execute(
                """
                SELECT a.http_status, a.error
                FROM attempts a
                JOIN deliveries d ON d.id=a.delivery_id
                WHERE d.endpoint_id=?
                ORDER BY a.ts_ms DESC
                LIMIT 50
                """,
                (endpoint_id,),
            ).fetchall()
            cons = 0
            for r in recent:
                status = r["http_status"]
                err = r["error"]
                if err is not None:
                    cons += 1
                    continue
                if status is None:
                    cons += 1
                    continue
                if status >= 400:
                    cons += 1
                    continue
                break

        return total, failures, cons
