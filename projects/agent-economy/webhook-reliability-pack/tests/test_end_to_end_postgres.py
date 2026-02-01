import json
import os
import threading
import time

import psycopg2

from wrp.dispatcher import worker_loop
from wrp.postgres_store import PostgresStorage
from wrp.util import now_ms

from tests.test_integration_server import Sink, run_server


def _dsn() -> str:
    dsn = os.environ.get("WRP_TEST_DSN")
    if not dsn:
        import pytest

        pytest.skip("WRP_TEST_DSN not set (skipping Postgres integration test)")
    return dsn


def _reset_db(dsn: str) -> None:
    # Clean slate to keep tests deterministic.
    with psycopg2.connect(dsn) as con:
        with con.cursor() as cur:
            cur.execute("TRUNCATE attempts, deliveries, events, endpoints")
        con.commit()


def test_end_to_end_postgres_delivers_event():
    Sink.calls = []
    Sink.statuses = []

    dsn = _dsn()
    _reset_db(dsn)

    httpd = run_server(8011)
    try:
        st = PostgresStorage(dsn)
        st.init_schema()
        ep = st.add_endpoint("http://127.0.0.1:8011/webhook", "sek", {"max_attempts": 2, "timeout_s": 2.0})
        evt, dly = st.enqueue_event("test", {"hello": "world", "_created_at_ms": now_ms()}, ep.id)

        th = threading.Thread(target=lambda: worker_loop(st, worker_id="pg1", poll_ms=50), daemon=True)
        th.start()

        for _ in range(100):
            if Sink.calls:
                break
            time.sleep(0.05)

        assert Sink.calls, "expected webhook to be called"
        path, headers, body = Sink.calls[-1]
        assert path == "/webhook"
        assert headers.get("X-Event-Id") == evt.id
        assert headers.get("X-Delivery-Id") == dly.id
        assert headers.get("X-Signature").startswith("v1=")
        env = json.loads(body.decode("utf-8"))
        assert env["type"] == "test"
        assert env["payload"]["hello"] == "world"
    finally:
        httpd.shutdown()
