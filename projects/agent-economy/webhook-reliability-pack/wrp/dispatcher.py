from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import requests

from .circuit import CircuitPolicy, CircuitState, circuit_allows_attempt, should_open
from .model import Delivery
from .policy import is_retryable_status, next_attempt_delay_ms
from .storage import Storage
from .util import now_ms, sign_v1, stable_json_bytes


@dataclass
class DispatchResult:
    ok: bool
    http_status: Optional[int]
    error: Optional[str]
    retry_after_s: Optional[int]
    latency_ms: int


def _extract_retry_after_s(resp: requests.Response) -> Optional[int]:
    ra = resp.headers.get("Retry-After")
    if not ra:
        return None
    try:
        return int(ra)
    except ValueError:
        return None


def _compute_signature(endpoint_secret: str, url: str, timestamp_ms: int, body_bytes: bytes) -> str:
    p = urlparse(url)
    path = p.path or "/"
    return sign_v1(secret=endpoint_secret, method="POST", path=path, timestamp_ms=timestamp_ms, body_bytes=body_bytes)


def dispatch_one(storage: Storage, delivery: Delivery, *, worker_id: str, lease_ms: int = 30_000) -> None:
    """Dispatch one claimed delivery.

    Must be safe under crashes: delivery lease will expire and be retried.
    """
    d = delivery
    endpoint = storage.get_endpoint(d.endpoint_id)

    # Endpoint paused/disabled
    if endpoint.status != "active":
        storage.mark_delivery_state(
            d.id,
            state="paused",
            attempt_count=d.attempt_count,
            next_attempt_at_ms=d.next_attempt_at_ms,
            last_error=f"endpoint_status={endpoint.status}",
        )
        storage.release_lease(d.id, worker_id)
        return

    policy = endpoint.policy or {}
    max_attempts = int(policy.get("max_attempts", 10))
    max_age_s = int(policy.get("max_age_s", 8 * 3600))
    timeout_s = float(policy.get("timeout_s", 10.0))

    # Circuit breaker check
    circ = (policy.get("circuit") or {})
    cstate = CircuitState(
        state=str(circ.get("state") or "closed"),
        opened_at_ms=circ.get("opened_at_ms"),
        cooldown_ms=int(circ.get("cooldown_ms") or 0),
    )
    allow, new_state = circuit_allows_attempt(now_ms(), cstate)
    if not allow:
        # Skip until next eligible time; leave delivery pending.
        next_at = (new_state.opened_at_ms or now_ms()) + new_state.cooldown_ms
        storage.mark_delivery_state(
            d.id,
            state="pending",
            attempt_count=d.attempt_count,
            next_attempt_at_ms=next_at,
            last_error="circuit_open",
        )
        storage.release_lease(d.id, worker_id)
        return

    # Load event payload (backend-agnostic)
    evt = storage.get_event(d.event_id)
    event_type = evt.type
    payload_obj = evt.payload or {}
    created_at_ms = int(evt.created_at_ms)

    if now_ms() - int(created_at_ms) > max_age_s * 1000:
        storage.mark_delivery_state(
            d.id,
            state="dlq",
            attempt_count=d.attempt_count,
            next_attempt_at_ms=now_ms(),
            last_error="expired_max_age",
        )
        storage.release_lease(d.id, worker_id)
        return

    event_envelope = {
        "type": event_type,
        "event_id": d.event_id,
        "created_at_ms": int(created_at_ms),
        "payload": payload_obj,
    }
    body_bytes = stable_json_bytes(event_envelope)
    ts = now_ms()
    sig = _compute_signature(endpoint.secret, endpoint.url, ts, body_bytes)

    headers = {
        "Content-Type": "application/json",
        "X-Event-Id": d.event_id,
        "X-Delivery-Id": d.id,
        "X-Attempt": str(d.attempt_count + 1),
        "X-Timestamp": str(ts),
        "X-Signature": sig,
        "Idempotency-Key": d.event_id,
    }

    start = time.time()
    http_status: Optional[int] = None
    err: Optional[str] = None
    retry_after_s: Optional[int] = None

    try:
        resp = requests.post(endpoint.url, data=body_bytes, headers=headers, timeout=timeout_s)
        http_status = resp.status_code
        retry_after_s = _extract_retry_after_s(resp)
    except Exception as e:
        err = f"{type(e).__name__}: {e}"

    latency_ms = int((time.time() - start) * 1000)
    attempt_no = d.attempt_count + 1
    storage.record_attempt(d.id, attempt_no, now_ms(), http_status, err, latency_ms)

    if err is None and http_status is not None and 200 <= http_status < 300:
        # Close circuit if we were probing
        if cstate.state in ("open", "half_open"):
            try:
                if hasattr(storage, "_conn"):
                    with storage._conn() as con:  # type: ignore[attr-defined]
                        con.execute(
                            "UPDATE endpoints SET circuit_state='closed', circuit_opened_at_ms=NULL, circuit_cooldown_ms=0 WHERE id=?",
                            (endpoint.id,),
                        )
            except Exception:
                pass

        storage.mark_delivery_state(
            d.id,
            state="delivered",
            attempt_count=attempt_no,
            next_attempt_at_ms=now_ms(),
            last_error=None,
        )
        storage.release_lease(d.id, worker_id)
        return

    # Update circuit state on failure
    try:
        attempts, failures, cons = storage.endpoint_failure_stats(endpoint.id, window_ms=5 * 60 * 1000, now_ms=now_ms())
        cp = CircuitPolicy()
        if should_open(attempts, failures, cons, cp):
            if hasattr(storage, "_conn"):
                cooldown = cp.cooldown_ms if cstate.state != "half_open" else cp.cooldown_ms_after_fail
                with storage._conn() as con:  # type: ignore[attr-defined]
                    con.execute(
                        "UPDATE endpoints SET circuit_state='open', circuit_opened_at_ms=?, circuit_cooldown_ms=? WHERE id=?",
                        (now_ms(), cooldown, endpoint.id),
                    )
    except Exception:
        pass

    # Determine retry or DLQ
    if attempt_no >= max_attempts:
        storage.mark_delivery_state(
            d.id,
            state="dlq",
            attempt_count=attempt_no,
            next_attempt_at_ms=now_ms(),
            last_error=err or f"http_{http_status}",
        )
        storage.release_lease(d.id, worker_id)
        return

    if not is_retryable_status(http_status if err is None else None):
        storage.mark_delivery_state(
            d.id,
            state="dlq",
            attempt_count=attempt_no,
            next_attempt_at_ms=now_ms(),
            last_error=err or f"http_{http_status}",
        )
        storage.release_lease(d.id, worker_id)
        return

    delay_ms = next_attempt_delay_ms(attempt_no, retry_after_s=retry_after_s)
    storage.mark_delivery_state(
        d.id,
        state="pending",
        attempt_count=attempt_no,
        next_attempt_at_ms=now_ms() + delay_ms,
        last_error=err or f"http_{http_status}",
    )
    storage.release_lease(d.id, worker_id)


def worker_loop(storage: Storage, *, worker_id: str, lease_ms: int = 30_000, poll_ms: int = 250) -> None:
    while True:
        d = storage.claim_next_delivery(now_ms=now_ms(), worker_id=worker_id, lease_ms=lease_ms)
        if not d:
            time.sleep(poll_ms / 1000.0)
            continue
        dispatch_one(storage, d, worker_id=worker_id, lease_ms=lease_ms)
