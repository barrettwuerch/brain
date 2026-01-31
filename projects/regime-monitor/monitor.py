#!/usr/bin/env python3
"""Regime Monitor (MVP)

Watches a Polymarket logger JSONL file and prints an alert when a token's
inside spread stays under a threshold for a streak of snapshots.

This is intentionally simple: stdout alerts only.

Usage:
  python3 monitor.py <jsonl_path> --spread 0.03 --streak 5

Notes:
- Expects JSONL records produced by projects/polymarket-bot/src/logger.py
- Uses best_ask - best_bid for each outcome token.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections import defaultdict
from typing import Dict, Tuple, Optional, Iterator


def spread_for(book: dict) -> Optional[float]:
    bid = book.get("best_bid")
    ask = book.get("best_ask")
    if bid is None or ask is None:
        return None
    return float(ask) - float(bid)


def mid_for(book: dict) -> Optional[float]:
    bid = book.get("best_bid")
    ask = book.get("best_ask")
    if bid is None or ask is None:
        return None
    return (float(bid) + float(ask)) / 2.0


def tail_f(path: str, sleep_s: float = 0.5) -> Iterator[Optional[str]]:
    """Follow a file like tail -f.

    Yields:
      - a line (str) when one is available
      - None on periodic polls when no new data exists (enables watchdog timers)
    """
    with open(path, "r", encoding="utf-8") as f:
        f.seek(0, os.SEEK_END)
        while True:
            line = f.readline()
            if not line:
                time.sleep(sleep_s)
                yield None
                continue
            yield line


def parse_iso(ts: str) -> float:
    # lightweight ISO parser without extra deps
    # handles e.g. 2026-01-31T16:00:00Z or with offset
    try:
        if ts.endswith("Z"):
            ts = ts.replace("Z", "+00:00")
        from datetime import datetime

        return datetime.fromisoformat(ts).timestamp()
    except Exception:
        return 0.0


def _split_csv(xs: Optional[list]) -> list:
    if not xs:
        return []
    out = []
    for x in xs:
        if x is None:
            continue
        parts = [p.strip() for p in str(x).split(",")]
        out.extend([p for p in parts if p])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="Path to logger JSONL")

    # Primary regime detection
    ap.add_argument("--spread", type=float, default=0.03, help="Spread threshold (default 0.03)")
    ap.add_argument("--streak", type=int, default=5, help="Consecutive snapshots required")
    ap.add_argument("--cooldown", type=int, default=60, help="Seconds between repeated alerts per token")
    ap.add_argument(
        "--min-remaining",
        type=int,
        default=60,
        help="Only alert if >= this many seconds remain in the 15m window (default 60)",
    )
    ap.add_argument(
        "--other-spread-max",
        type=float,
        default=0.10,
        help="Require the opposite outcome spread <= this value (default 0.10)",
    )

    # Health / watchdog
    ap.add_argument(
        "--stale-after",
        type=float,
        default=15.0,
        help="Emit health stale after N seconds without snapshots (default 15)",
    )
    ap.add_argument(
        "--health-interval",
        type=float,
        default=60.0,
        help="While stale, emit at most once per N seconds (default 60)",
    )

    # Filtering
    ap.add_argument("--asset", action="append", default=[], help="Asset filter (repeatable), e.g. --asset BTC")
    ap.add_argument("--assets", type=str, default="", help="Asset filter CSV, e.g. --assets BTC,ETH")
    ap.add_argument(
        "--outcome", action="append", default=[], help="Outcome filter (repeatable), e.g. --outcome Up"
    )
    ap.add_argument("--outcomes", type=str, default="", help="Outcome filter CSV, e.g. --outcomes Up,Down")

    # Output
    ap.add_argument("--log", type=str, default="", help="Optional alerts log file (appends JSON lines)")
    ap.add_argument(
        "--mode",
        choices=("json", "text"),
        default="json",
        help="Output mode: json (default) or text",
    )

    args = ap.parse_args()

    asset_allow = set(_split_csv(args.asset + ([args.assets] if args.assets else [])))
    outcome_allow = set(_split_csv(args.outcome + ([args.outcomes] if args.outcomes else [])))

    streak = defaultdict(int)  # (asset,outcome) -> count
    last_alert_at: Dict[Tuple[str, str], float] = {}

    # Watchdog state
    last_snapshot_wall: Optional[float] = None
    stale = False
    last_health_emit_wall: float = 0.0

    log_fh = open(args.log, "a", encoding="utf-8") if args.log else None

    def emit_json(evt: dict):
        line = json.dumps(evt, ensure_ascii=False)
        print(line)
        if log_fh:
            log_fh.write(line + "\n")
            log_fh.flush()

    def emit_text(line: str):
        print(line)

    def emit(evt: dict):
        if args.mode == "json":
            emit_json(evt)
        else:
            # Minimal line-oriented text mode.
            t = evt.get("type")
            if t == "health":
                if evt.get("status") == "stale":
                    emit_text(
                        f"HEALTH STALE: no snapshots for {evt.get('seconds_since_snapshot')}s (path={evt.get('path')})"
                    )
                else:
                    emit_text(f"HEALTH OK: snapshots resumed (path={evt.get('path')})")
                return

            if t == "regime":
                bid = evt.get("best_bid")
                ask = evt.get("best_ask")
                spread = evt.get("spread")
                spread_bps = evt.get("spread_bps")
                emit_text(
                    " ".join(
                        [
                            "REGIME",
                            str(evt.get("ts")),
                            str(evt.get("asset")),
                            str(evt.get("outcome")),
                            f"bid={bid}",
                            f"ask={ask}",
                            f"spread={spread}",
                            f"({spread_bps} bps)",
                            f"streak={evt.get('streak')}",
                            f"remaining_s={evt.get('remaining_s')}",
                            f"slug={evt.get('slug')}",
                        ]
                    )
                )
                return

            emit_text(str(evt))

    def maybe_emit_health(now_wall: float):
        nonlocal stale, last_health_emit_wall
        if last_snapshot_wall is None:
            return
        gap = now_wall - last_snapshot_wall
        if gap <= args.stale_after:
            return
        if now_wall - last_health_emit_wall < args.health_interval:
            return

        stale = True
        last_health_emit_wall = now_wall
        emit(
            {
                "type": "health",
                "status": "stale",
                "seconds_since_snapshot": int(gap),
                "path": args.path,
                "ts": time.time(),
            }
        )

    for line in tail_f(args.path):
        now_wall = time.time()
        maybe_emit_health(now_wall)

        if line is None:
            continue

        try:
            rec = json.loads(line)
        except Exception:
            continue
        if rec.get("type") != "snapshot":
            continue

        # Recovery hook
        last_snapshot_wall = now_wall
        if stale:
            stale = False
            # Emit recovery exactly once (first snapshot after stale)
            emit({"type": "health", "status": "ok", "path": args.path, "ts": rec.get("ts")})

        ts = rec.get("ts")
        t_now = parse_iso(ts) if ts else now_wall

        for asset, a in (rec.get("assets", {}) or {}).items():
            if asset_allow and asset not in asset_allow:
                continue

            end_date = a.get("end_date")
            remaining = None
            if end_date:
                t_end = parse_iso(end_date)
                if t_end:
                    remaining = int(t_end - t_now)
                    if remaining < args.min_remaining:
                        continue

            books = a.get("books", {}) or {}
            for outcome, b in books.items():
                if outcome_allow and outcome not in outcome_allow:
                    continue

                s = spread_for(b)
                key = (asset, outcome)

                if s is not None and s <= args.spread:
                    streak[key] += 1
                else:
                    streak[key] = 0

                if streak[key] < args.streak:
                    continue

                # require opposite outcome not blown out
                other = "Down" if outcome == "Up" else "Up"
                other_book = books.get(other, {})
                s_other = spread_for(other_book)
                if s_other is not None and s_other > args.other_spread_max:
                    continue

                if now_wall - last_alert_at.get(key, 0) < args.cooldown:
                    continue

                last_alert_at[key] = now_wall
                bid = b.get("best_bid")
                ask = b.get("best_ask")
                mid = mid_for(b)
                spread_bps = None
                if s is not None:
                    spread_bps = int(round(float(s) * 10000.0))

                evt = {
                    "type": "regime",
                    "ts": ts,
                    "asset": asset,
                    "outcome": outcome,
                    "slug": a.get("slug"),
                    "token_id": b.get("token_id"),
                    "best_bid": bid,
                    "best_ask": ask,
                    "mid": mid,
                    "spread": s,
                    "spread_bps": spread_bps,
                    "spread_threshold": args.spread,
                    "streak": streak[key],
                    "remaining_s": remaining,
                    "other_spread": s_other,
                }
                emit(evt)


if __name__ == "__main__":
    try:
        main()
    finally:
        pass
