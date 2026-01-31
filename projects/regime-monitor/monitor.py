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
from typing import Dict, Tuple, Optional


def spread_for(book: dict) -> Optional[float]:
    bid = book.get("best_bid")
    ask = book.get("best_ask")
    if bid is None or ask is None:
        return None
    return float(ask) - float(bid)


def tail_f(path: str, sleep_s: float = 0.5):
    """Follow a file like tail -f."""
    with open(path, "r", encoding="utf-8") as f:
        # go to end
        f.seek(0, os.SEEK_END)
        while True:
            line = f.readline()
            if not line:
                time.sleep(sleep_s)
                continue
            yield line


def parse_iso(ts: str) -> float:
    # lightweight ISO parser without extra deps
    # handles e.g. 2026-01-31T16:00:00Z or with offset
    try:
        if ts.endswith('Z'):
            ts = ts.replace('Z', '+00:00')
        from datetime import datetime
        return datetime.fromisoformat(ts).timestamp()
    except Exception:
        return 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="Path to logger JSONL")
    ap.add_argument("--spread", type=float, default=0.03, help="Spread threshold (default 0.03)")
    ap.add_argument("--streak", type=int, default=5, help="Consecutive snapshots required")
    ap.add_argument("--cooldown", type=int, default=60, help="Seconds between repeated alerts per token")
    ap.add_argument("--min-remaining", type=int, default=60, help="Only alert if >= this many seconds remain in the 15m window (default 60)")
    ap.add_argument("--other-spread-max", type=float, default=0.10, help="Require the opposite outcome spread <= this value (default 0.10)")
    ap.add_argument("--log", type=str, default="", help="Optional alerts log file (appends JSON lines)")
    args = ap.parse_args()

    streak = defaultdict(int)  # (asset,outcome) -> count
    last_alert_at: Dict[Tuple[str, str], float] = {}

    log_fh = open(args.log, "a", encoding="utf-8") if args.log else None

    def emit(evt: dict):
        line = json.dumps(evt, ensure_ascii=False)
        print(line)
        if log_fh:
            log_fh.write(line + "\n")
            log_fh.flush()

    for line in tail_f(args.path):
        try:
            rec = json.loads(line)
        except Exception:
            continue
        if rec.get("type") != "snapshot":
            continue

        ts = rec.get("ts")
        t_now = parse_iso(ts) if ts else time.time()

        for asset, a in (rec.get("assets", {}) or {}).items():
            end_date = a.get("end_date")
            remaining = None
            if end_date:
                t_end = parse_iso(end_date)
                if t_end:
                    remaining = int(t_end - t_now)
                    if remaining < args.min_remaining:
                        # too late in the window to be useful
                        continue

            books = a.get("books", {}) or {}
            for outcome, b in books.items():
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

                now = time.time()
                if now - last_alert_at.get(key, 0) < args.cooldown:
                    continue

                last_alert_at[key] = now
                evt = {
                    "type": "regime",
                    "ts": ts,
                    "asset": asset,
                    "outcome": outcome,
                    "slug": a.get("slug"),
                    "spread": s,
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
