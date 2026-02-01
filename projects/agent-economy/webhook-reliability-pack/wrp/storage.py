from __future__ import annotations

import abc
from typing import Any, Dict, Iterable, Optional, Tuple

from .model import Attempt, Delivery, Endpoint, Event


class Storage(abc.ABC):
    """Minimal durable state interface.

    PRD invariants:
    - enqueue_event() must durably record events+deliveries before returning.
    - claim_next_delivery() provides a lease to ensure single active worker.
    """

    @abc.abstractmethod
    def init_schema(self) -> None:
        ...

    @abc.abstractmethod
    def add_endpoint(self, url: str, secret: str, policy: Dict[str, Any]) -> Endpoint:
        ...

    @abc.abstractmethod
    def get_endpoint(self, endpoint_id: str) -> Endpoint:
        ...

    @abc.abstractmethod
    def list_endpoints(self) -> Iterable[Endpoint]:
        ...

    @abc.abstractmethod
    def enqueue_event(self, event_type: str, payload: Dict[str, Any], endpoint_id: str) -> Tuple[Event, Delivery]:
        ...

    @abc.abstractmethod
    def get_event(self, event_id: str) -> Event:
        ...

    @abc.abstractmethod
    def get_delivery(self, delivery_id: str) -> Delivery:
        ...

    @abc.abstractmethod
    def list_dlq(self, endpoint_id: Optional[str] = None, limit: int = 50) -> Iterable[Delivery]:
        ...

    @abc.abstractmethod
    def replay_delivery(self, delivery_id: str, now_ms: int) -> None:
        ...

    @abc.abstractmethod
    def record_attempt(self, delivery_id: str, attempt_no: int, ts_ms: int, http_status: Optional[int], error: Optional[str], latency_ms: Optional[int]) -> Attempt:
        ...

    @abc.abstractmethod
    def mark_delivery_state(self, delivery_id: str, *, state: str, attempt_count: int, next_attempt_at_ms: int, last_error: Optional[str]) -> None:
        ...

    @abc.abstractmethod
    def claim_next_delivery(self, *, now_ms: int, worker_id: str, lease_ms: int) -> Optional[Delivery]:
        """Atomically claim the next due delivery that is not leased (or lease expired)."""
        ...

    @abc.abstractmethod
    def release_lease(self, delivery_id: str, worker_id: str) -> None:
        ...

    @abc.abstractmethod
    def endpoint_failure_stats(self, endpoint_id: str, *, window_ms: int, now_ms: int) -> Tuple[int, int, int]:
        """Return (attempts, failures, consecutive_failures) for the endpoint."""
        ...

    @abc.abstractmethod
    def set_endpoint_circuit(self, endpoint_id: str, *, state: str, opened_at_ms: Optional[int], cooldown_ms: int) -> None:
        ...
