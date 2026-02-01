from __future__ import annotations

import hashlib
import hmac
import json
import os
import random
import time
import uuid
from typing import Any, Dict, Tuple


def now_ms() -> int:
    return int(time.time() * 1000)


def gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def stable_json_bytes(obj: Dict[str, Any]) -> bytes:
    # Deterministic JSON encoding to maximize signature stability.
    return json.dumps(obj, separators=(",", ":"), sort_keys=True).encode("utf-8")


def sign_v1(*, secret: str, method: str, path: str, timestamp_ms: int, body_bytes: bytes) -> str:
    signed = (method.upper() + "\n" + path + "\n" + str(timestamp_ms) + "\n").encode("utf-8") + body_bytes
    mac = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"v1={mac}"


def jittered_backoff_ms(base_ms: int, jitter: float = 0.2) -> int:
    # +/- jitter fraction
    delta = base_ms * jitter
    return int(base_ms + random.uniform(-delta, delta))


def sleep_ms(ms: int) -> None:
    time.sleep(ms / 1000.0)
