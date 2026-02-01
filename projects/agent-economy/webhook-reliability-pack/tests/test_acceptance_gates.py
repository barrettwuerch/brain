import os
import tempfile
import time

import pytest

from wrp.dispatcher import dispatch_one
from wrp.postgres_store import PostgresStorage
from wrp.sqlite_store import SQLiteStorage
from wrp.util import now_ms

from tests.test_integration_server import Sink, run_server


def _reset_sink():
    Sink.calls = []
    Sink.statuses = []
    Sink.headers = []
    Sink.delays_s = []


@pytest.fixture(params=["sqlite", "postgres"])
def store(request):
    if request.param == "sqlite":
        db = os.path.join(tempfile.gettempdir(), f"wrp_accept_{os.getpid()}.db")
        try:
            os.remove(db)
        except FileNotFoundError:
            pass
        st = SQLiteStorage(db)
        st.init_schema()
        return st

    dsn = os.environ.get("WRP_TEST_DSN")
    if not dsn:
        pytest.skip("WRP_TEST_DSN not set (skipping Postgres acceptance tests)")

    if os.environ.get("WRP_TEST_EXCLUSIVE") != "1":
        pytest.skip("Postgres acceptance tests require exclusive DB access (no other WRP workers). Set WRP_TEST_EXCLUSIVE=1")

    st = PostgresStorage(dsn)
    st.init_schema()

    # clean slate
    import psycopg2

    with psycopg2.connect(dsn) as con:
        with con.cursor() as cur:
            cur.execute("TRUNCATE attempts, deliveries, events, endpoints")
        con.commit()

    return st


def test_retry_500_then_200_eventually_delivers(store):
    _reset_sink()
    httpd = run_server(8021)
    try:
        # first attempt fails, second succeeds
        Sink.statuses = [500, 200]

        ep = store.add_endpoint(
            "http://127.0.0.1:8021/webhook",
            "sek",
            {"max_attempts": 3, "timeout_s": 1.0, "backoff_s": [0, 0, 0]},
        )
        _, dly = store.enqueue_event("t", {"x": 1, "_created_at_ms": now_ms()}, ep.id)

        # Attempt 1
        d = store.claim_next_delivery(now_ms=now_ms(), worker_id="w1", lease_ms=5_000)
        assert d is not None
        dispatch_one(store, d, worker_id="w1")

        # Attempt 2 (due immediately because backoff=0)
        for _ in range(50):
            d2 = store.claim_next_delivery(now_ms=now_ms(), worker_id="w2", lease_ms=5_000)
            if d2:
                dispatch_one(store, d2, worker_id="w2")
                break
            time.sleep(0.01)

        out = store.get_delivery(dly.id)
        assert out.state == "delivered"
        assert out.attempt_count == 2
        assert len(Sink.calls) >= 2
    finally:
        httpd.shutdown()


def test_410_goes_to_dlq_immediately(store):
    _reset_sink()
    httpd = run_server(8022)
    try:
        Sink.statuses = [410]
        ep = store.add_endpoint(
            "http://127.0.0.1:8022/webhook",
            "sek",
            {"max_attempts": 10, "timeout_s": 1.0, "backoff_s": [0]},
        )
        _, dly = store.enqueue_event("t", {"x": 1, "_created_at_ms": now_ms()}, ep.id)

        d = store.claim_next_delivery(now_ms=now_ms(), worker_id="w1", lease_ms=5_000)
        assert d is not None
        dispatch_one(store, d, worker_id="w1")

        out = store.get_delivery(dly.id)
        assert out.state == "dlq"
        assert out.attempt_count == 1
        assert len(Sink.calls) == 1
    finally:
        httpd.shutdown()


def test_429_honors_retry_after_in_next_attempt_at(store):
    _reset_sink()
    httpd = run_server(8023)
    try:
        # respond 429 with Retry-After: 1
        Sink.statuses = [429]
        Sink.headers = [{"Retry-After": "1"}]

        ep = store.add_endpoint(
            "http://127.0.0.1:8023/webhook",
            "sek",
            {"max_attempts": 3, "timeout_s": 1.0, "backoff_s": [0, 0, 0]},
        )
        _, dly = store.enqueue_event("t", {"x": 1, "_created_at_ms": now_ms()}, ep.id)

        before = now_ms()
        d = store.claim_next_delivery(now_ms=before, worker_id="w1", lease_ms=5_000)
        assert d is not None
        dispatch_one(store, d, worker_id="w1")

        out = store.get_delivery(dly.id)
        assert out.state == "pending"
        # Retry-After is 1s with jitter 0.1 => should be around ~900ms..1100ms
        assert out.next_attempt_at_ms >= before + 850
    finally:
        httpd.shutdown()


def test_crash_recovery_lease_expires_and_another_worker_can_claim(store):
    # This test requires exclusive access to the DB (no other WRP workers running).
    # On Bear's laptop we often have a launchd worker pointed at the same Postgres DB.
    if isinstance(store, PostgresStorage) and os.environ.get("WRP_TEST_EXCLUSIVE") != "1":
        pytest.skip("requires exclusive Postgres DB access; set WRP_TEST_EXCLUSIVE=1 and ensure no other workers are running")
    _reset_sink()
    httpd = run_server(8024)
    try:
        Sink.statuses = [200]
        ep = store.add_endpoint(
            "http://127.0.0.1:8024/webhook",
            "sek",
            {"max_attempts": 1, "timeout_s": 1.0, "backoff_s": [0]},
        )
        _, dly = store.enqueue_event("t", {"x": 1, "_created_at_ms": now_ms()}, ep.id)

        # Simulate crash: claim with short lease and do NOT dispatch/release.
        t0 = now_ms()
        d = store.claim_next_delivery(now_ms=t0, worker_id="crash", lease_ms=100)
        assert d is not None

        # After lease expiry, another worker should claim.
        time.sleep(0.15)
        d2 = store.claim_next_delivery(now_ms=now_ms(), worker_id="w2", lease_ms=5_000)
        assert d2 is not None
        dispatch_one(store, d2, worker_id="w2")

        out = store.get_delivery(dly.id)
        assert out.state == "delivered"
    finally:
        httpd.shutdown()


def test_circuit_opens_after_consecutive_failures(store):
    _reset_sink()
    httpd = run_server(8025)
    try:
        # Always fail
        Sink.statuses = [500, 500, 500]

        ep = store.add_endpoint(
            "http://127.0.0.1:8025/webhook",
            "sek",
            {
                "max_attempts": 3,
                "timeout_s": 1.0,
                "backoff_s": [0, 0, 0],
                "circuit_policy": {
                    "min_attempts": 1,
                    "open_failure_rate": 1.0,
                    "consecutive_failures_fallback": 1,
                    "cooldown_ms": 10_000,
                },
            },
        )
        _, dly = store.enqueue_event("t", {"x": 1, "_created_at_ms": now_ms()}, ep.id)

        # Attempt 1 -> failure should open circuit
        d = store.claim_next_delivery(now_ms=now_ms(), worker_id="w1", lease_ms=5_000)
        assert d is not None
        dispatch_one(store, d, worker_id="w1")

        ep2 = store.get_endpoint(ep.id)
        assert (ep2.policy.get("circuit") or {}).get("state") == "open"

        # Try to run again immediately: circuit should prevent another HTTP call
        calls_before = len(Sink.calls)
        d2 = store.claim_next_delivery(now_ms=now_ms(), worker_id="w2", lease_ms=5_000)
        assert d2 is not None
        dispatch_one(store, d2, worker_id="w2")

        assert len(Sink.calls) == calls_before
        out = store.get_delivery(dly.id)
        assert out.state == "pending"
        assert out.last_error == "circuit_open"
    finally:
        httpd.shutdown()
