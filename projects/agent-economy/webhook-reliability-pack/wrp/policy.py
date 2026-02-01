from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .util import jittered_backoff_ms


DEFAULT_BACKOFF_S = [10, 30, 60, 180, 420, 900, 1800, 3600, 7200, 14400]  # ~8h


@dataclass(frozen=True)
class RetryDecision:
    retry: bool
    retry_after_ms: Optional[int]
    reason: str


def is_retryable_status(status: Optional[int]) -> bool:
    if status is None:
        return True  # network error
    if status in (408, 425, 429):
        return True
    if 500 <= status <= 599:
        return True
    return False


def next_attempt_delay_ms(
    attempt_no: int,
    *,
    retry_after_s: Optional[int] = None,
    backoff_s: Optional[list[float]] = None,
) -> int:
    """Compute delay until next attempt.

    - If Retry-After is present and >0, it wins.
    - Otherwise use exponential-ish backoff schedule.
    - backoff_s can be overridden per-endpoint (useful for tests or tuning).
    """
    if retry_after_s is not None and retry_after_s > 0:
        return jittered_backoff_ms(int(retry_after_s * 1000), jitter=0.1)

    sched = backoff_s if backoff_s else [float(x) for x in DEFAULT_BACKOFF_S]
    idx = max(0, min(attempt_no - 1, len(sched) - 1))
    return jittered_backoff_ms(int(sched[idx] * 1000))
