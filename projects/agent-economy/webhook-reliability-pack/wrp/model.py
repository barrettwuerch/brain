from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class Endpoint:
    id: str
    url: str
    secret: str
    status: str  # active|paused|disabled
    policy: Dict[str, Any]


@dataclass(frozen=True)
class Event:
    id: str
    type: str
    payload: Dict[str, Any]
    created_at_ms: int


@dataclass(frozen=True)
class Delivery:
    id: str
    event_id: str
    endpoint_id: str
    state: str  # pending|delivering|delivered|dlq|paused
    attempt_count: int
    next_attempt_at_ms: int
    last_error: Optional[str]
    lease_owner: Optional[str]
    lease_expires_at_ms: Optional[int]


@dataclass(frozen=True)
class Attempt:
    id: str
    delivery_id: str
    attempt_no: int
    ts_ms: int
    http_status: Optional[int]
    error: Optional[str]
    latency_ms: Optional[int]
