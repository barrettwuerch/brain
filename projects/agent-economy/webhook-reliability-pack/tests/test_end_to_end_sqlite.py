import json
import os
import tempfile
import threading
import time

from wrp.dispatcher import worker_loop
from wrp.sqlite_store import SQLiteStorage
from wrp.util import now_ms

from tests.test_integration_server import Sink, run_server


def test_end_to_end_sqlite_delivers_event():
    httpd = run_server(8009)
    try:
        db = os.path.join(tempfile.gettempdir(), "wrp_it.db")
        try:
            os.remove(db)
        except FileNotFoundError:
            pass
        st = SQLiteStorage(db)
        st.init_schema()
        ep = st.add_endpoint("http://127.0.0.1:8009/webhook", "sek", {"max_attempts": 2, "timeout_s": 2.0})
        evt, dly = st.enqueue_event("test", {"hello": "world", "_created_at_ms": now_ms()}, ep.id)

        # run worker in background briefly
        th = threading.Thread(target=lambda: worker_loop(st, worker_id="t1", poll_ms=50), daemon=True)
        th.start()

        # wait for at least one call
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
