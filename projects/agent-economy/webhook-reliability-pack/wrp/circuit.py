from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple


@dataclass(frozen=True)
class CircuitPolicy:
    window_ms: int = 5 * 60 * 1000
    min_attempts: int = 5
    open_failure_rate: float = 0.5
    consecutive_failures_fallback: int = 10
    cooldown_ms: int = 60 * 60 * 1000
    cooldown_ms_after_fail: int = 4 * 60 * 60 * 1000


@dataclass
class CircuitState:
    state: str  # closed|open|half_open
    opened_at_ms: int | None = None
    cooldown_ms: int = 0


def should_open(attempts: int, failures: int, consecutive_failures: int, policy: CircuitPolicy) -> bool:
    if consecutive_failures >= policy.consecutive_failures_fallback:
        return True
    if attempts < policy.min_attempts:
        return False
    if attempts <= 0:
        return False
    return (failures / float(attempts)) >= policy.open_failure_rate


def circuit_allows_attempt(now_ms: int, circuit_state: CircuitState) -> Tuple[bool, CircuitState]:
    if circuit_state.state == "closed":
        return True, circuit_state
    if circuit_state.state == "open":
        assert circuit_state.opened_at_ms is not None
        if now_ms - circuit_state.opened_at_ms >= circuit_state.cooldown_ms:
            # half-open probe
            return True, CircuitState(state="half_open", opened_at_ms=circuit_state.opened_at_ms, cooldown_ms=circuit_state.cooldown_ms)
        return False, circuit_state
    if circuit_state.state == "half_open":
        # allow exactly one probe attempt; the worker should set state to open/closed based on result.
        return True, circuit_state
    return True, circuit_state
