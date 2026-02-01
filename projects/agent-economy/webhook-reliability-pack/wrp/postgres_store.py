from __future__ import annotations

import json
from typing import Any, Dict, Iterable, Optional, Tuple

import psycopg2
import psycopg2.extras

from .model import Attempt, Delivery, Endpoint, Event
from .storage import Storage
from .util import gen_id


class PostgresStorage(Storage):
    """Postgres-backed durable storage.

    DSN examples:
      postgres://user:pass@localhost:5432/wrp
    """

    def __init__(self, dsn: str):
        self.dsn = dsn

    def _conn(self):
        con = psycopg2.connect(self.dsn)
        con.autocommit = False
        return con

    def init_schema(self) -> None:
        with self._conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS endpoints (
                      id TEXT PRIMARY KEY,
                      url TEXT NOT NULL,
                      secret TEXT NOT NULL,
                      status TEXT NOT NULL,
                      policy_json JSONB NOT NULL,
                      circuit_state TEXT NOT NULL DEFAULT 'closed',
                      circuit_opened_at_ms BIGINT,
                      circuit_cooldown_ms BIGINT NOT NULL DEFAULT 0
                    );

                    CREATE TABLE IF NOT EXISTS events (
                      id TEXT PRIMARY KEY,
                      type TEXT NOT NULL,
                      payload_json JSONB NOT NULL,
                      created_at_ms BIGINT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS deliveries (
                      id TEXT PRIMARY KEY,
                      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
                      endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
                      state TEXT NOT NULL,
                      attempt_count INTEGER NOT NULL,
                      next_attempt_at_ms BIGINT NOT NULL,
                      last_error TEXT,
                      lease_owner TEXT,
                      lease_expires_at_ms BIGINT
                    );
                    CREATE INDEX IF NOT EXISTS idx_deliveries_due ON deliveries(next_attempt_at_ms);
                    CREATE INDEX IF NOT EXISTS idx_deliveries_endpoint ON deliveries(endpoint_id);

                    CREATE TABLE IF NOT EXISTS attempts (
                      id TEXT PRIMARY KEY,
                      delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
                      attempt_no INTEGER NOT NULL,
                      ts_ms BIGINT NOT NULL,
                      http_status INTEGER,
                      error TEXT,
                      latency_ms INTEGER
                    );
                    CREATE INDEX IF NOT EXISTS idx_attempts_delivery ON attempts(delivery_id);
                    CREATE INDEX IF NOT EXISTS idx_attempts_ts ON attempts(ts_ms);
                    """
                )
            con.commit()

    def add_endpoint(self, url: str, secret: str, policy: Dict[str, Any]) -> Endpoint:
        endpoint_id = gen_id("ep")
        with self._conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    "INSERT INTO endpoints(id,url,secret,status,policy_json) VALUES (%s,%s,%s,%s,%s)",
                    (endpoint_id, url, secret, "active", json.dumps(policy)),
                )
            con.commit()
        return self.get_endpoint(endpoint_id)

    def get_endpoint(self, endpoint_id: str) -> Endpoint:
        with self._conn() as con:
            with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM endpoints WHERE id=%s", (endpoint_id,))
                row = cur.fetchone()
                if not row:
                    raise KeyError(f"endpoint not found: {endpoint_id}")
                policy = row["policy_json"] or {}
                if isinstance(policy, str):
                    policy = json.loads(policy)
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
            with con.cursor() as cur:
                cur.execute("SELECT id FROM endpoints ORDER BY id")
                ids = [r[0] for r in cur.fetchall()]
        for eid in ids:
            yield self.get_endpoint(eid)

    def enqueue_event(self, event_type: str, payload: Dict[str, Any], endpoint_id: str) -> Tuple[Event, Delivery]:
        event_id = gen_id("evt")
        delivery_id = gen_id("dly")
        created_at_ms = payload.get("_created_at_ms")
        if not isinstance(created_at_ms, int):
            created_at_ms = None
        if created_at_ms is None:
            import time

            created_at_ms = int(time.time() * 1000)

        with self._conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    "INSERT INTO events(id,type,payload_json,created_at_ms) VALUES (%s,%s,%s,%s)",
                    (event_id, event_type, json.dumps(payload), created_at_ms),
                )
                cur.execute(
                    "INSERT INTO deliveries(id,event_id,endpoint_id,state,attempt_count,next_attempt_at_ms,last_error,lease_owner,lease_expires_at_ms) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (delivery_id, event_id, endpoint_id, "pending", 0, created_at_ms, None, None, None),
                )
            con.commit()

        return (
            Event(id=event_id, type=event_type, payload=payload, created_at_ms=created_at_ms),
            self.get_delivery(delivery_id),
        )

    def get_event(self, event_id: str) -> Event:
        with self._conn() as con:
            with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM events WHERE id=%s", (event_id,))
                row = cur.fetchone()
                if not row:
                    raise KeyError(f"event not found: {event_id}")
                payload = row["payload_json"]
                if isinstance(payload, str):
                    payload = json.loads(payload)
                return Event(id=row["id"], type=row["type"], payload=payload, created_at_ms=int(row["created_at_ms"]))

    def get_delivery(self, delivery_id: str) -> Delivery:
        with self._conn() as con:
            with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM deliveries WHERE id=%s", (delivery_id,))
                row = cur.fetchone()
                if not row:
                    raise KeyError(f"delivery not found: {delivery_id}")
                return Delivery(
                    id=row["id"],
                    event_id=row["event_id"],
                    endpoint_id=row["endpoint_id"],
                    state=row["state"],
                    attempt_count=int(row["attempt_count"]),
                    next_attempt_at_ms=int(row["next_attempt_at_ms"]),
                    last_error=row.get("last_error"),
                    lease_owner=row.get("lease_owner"),
                    lease_expires_at_ms=row.get("lease_expires_at_ms"),
                )

    def list_dlq(self, endpoint_id: Optional[str] = None, limit: int = 50) -> Iterable[Delivery]:
        q = "SELECT id FROM deliveries WHERE state='dlq'"
        params: list[Any] = []
        if endpoint_id:
            q += " AND endpoint_id=%s"
            params.append(endpoint_id)
        q += " ORDER BY next_attempt_at_ms DESC LIMIT %s"
        params.append(limit)
        with self._conn() as con:
            with con.cursor() as cur:
                cur.execute(q, tuple(params))
                ids = [r[0] for r in cur.fetchall()]
        for did in ids:
            yield self.get_delivery(did)

    def replay_delivery(self, delivery_id: str, now_ms: int) -> None:
        with self._conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    "UPDATE deliveries SET state='pending', next_attempt_at_ms=%s, last_error=NULL WHERE id=%s",
                    (now_ms, delivery_id),
                )
            con.commit()

    def record_attempt(
        self,
        delivery_id: str,
        attempt_no: int,
        ts_ms: int,
        http_status: Optional[int],
        error: Optional[str],
        latency_ms: Optional[int],
    ) -> Attempt:
        attempt_id = gen_id("att")
        with self._conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    "INSERT INTO attempts(id,delivery_id,attempt_no,ts_ms,http_status,error,latency_ms) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                    (attempt_id, delivery_id, attempt_no, ts_ms, http_status, error, latency_ms),
                )
            con.commit()
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
            with con.cursor() as cur:
                cur.execute(
                    "UPDATE deliveries SET state=%s, attempt_count=%s, next_attempt_at_ms=%s, last_error=%s WHERE id=%s",
                    (state, attempt_count, next_attempt_at_ms, last_error, delivery_id),
                )
            con.commit()

    def claim_next_delivery(self, *, now_ms: int, worker_id: str, lease_ms: int) -> Optional[Delivery]:
        lease_exp = now_ms + lease_ms
        with self._conn() as con:
            with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    WITH cte AS (
                      SELECT id
                      FROM deliveries
                      WHERE state IN ('pending','delivering')
                        AND next_attempt_at_ms <= %s
                        AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= %s)
                      ORDER BY next_attempt_at_ms ASC
                      LIMIT 1
                      FOR UPDATE SKIP LOCKED
                    )
                    UPDATE deliveries
                    SET lease_owner=%s, lease_expires_at_ms=%s, state='delivering'
                    WHERE id IN (SELECT id FROM cte)
                    RETURNING *
                    """,
                    (now_ms, now_ms, worker_id, lease_exp),
                )
                row = cur.fetchone()
                con.commit()
                if not row:
                    return None
                return Delivery(
                    id=row["id"],
                    event_id=row["event_id"],
                    endpoint_id=row["endpoint_id"],
                    state=row["state"],
                    attempt_count=int(row["attempt_count"]),
                    next_attempt_at_ms=int(row["next_attempt_at_ms"]),
                    last_error=row.get("last_error"),
                    lease_owner=row.get("lease_owner"),
                    lease_expires_at_ms=row.get("lease_expires_at_ms"),
                )

    def release_lease(self, delivery_id: str, worker_id: str) -> None:
        with self._conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    "UPDATE deliveries SET lease_owner=NULL, lease_expires_at_ms=NULL WHERE id=%s AND lease_owner=%s",
                    (delivery_id, worker_id),
                )
            con.commit()

    def endpoint_failure_stats(self, endpoint_id: str, *, window_ms: int, now_ms: int) -> Tuple[int, int, int]:
        start = now_ms - window_ms
        with self._conn() as con:
            with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT a.http_status, a.error
                    FROM attempts a
                    JOIN deliveries d ON d.id=a.delivery_id
                    WHERE d.endpoint_id=%s AND a.ts_ms >= %s
                    """,
                    (endpoint_id, start),
                )
                rows = cur.fetchall()
                total = len(rows)
                failures = 0
                for r in rows:
                    status = r.get("http_status")
                    err = r.get("error")
                    if err is not None:
                        failures += 1
                    elif status is None:
                        failures += 1
                    elif int(status) >= 400:
                        failures += 1

                cur.execute(
                    """
                    SELECT a.http_status, a.error
                    FROM attempts a
                    JOIN deliveries d ON d.id=a.delivery_id
                    WHERE d.endpoint_id=%s
                    ORDER BY a.ts_ms DESC
                    LIMIT 50
                    """,
                    (endpoint_id,),
                )
                recent = cur.fetchall()
                cons = 0
                for r in recent:
                    status = r.get("http_status")
                    err = r.get("error")
                    if err is not None:
                        cons += 1
                        continue
                    if status is None:
                        cons += 1
                        continue
                    if int(status) >= 400:
                        cons += 1
                        continue
                    break

        return total, failures, cons

    # Convenience for CLI
    def status_counts(self) -> Dict[str, Any]:
        with self._conn() as con:
            with con.cursor() as cur:
                cur.execute("SELECT state, COUNT(*) FROM deliveries GROUP BY state")
                by_state = {r[0]: r[1] for r in cur.fetchall()}
                cur.execute("SELECT circuit_state, COUNT(*) FROM endpoints GROUP BY circuit_state")
                circuits = {r[0]: r[1] for r in cur.fetchall()}
        return {"deliveries": by_state, "circuits": circuits}
