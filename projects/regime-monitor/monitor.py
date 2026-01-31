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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="Path to logger JSONL")
    ap.add_argument("--spread", type=float, default=0.03, help="Spread threshold (default 0.03)")
    ap.add_argument("--streak", type=int, default=5, help="Consecutive snapshots required")
    ap.add_argument("--cooldown", type=int, default=60, help="Seconds between repeated alerts per token")
    args = ap.parse_args()

    # streak counters per (asset,outcome)
    streak = defaultdict(int)
    last_alert_at: Dict[Tuple[str, str], float] = {}

    for line in tail_f(args.path):
        try:
            rec = json.loads(line)
        except Exception:
            continue
        if rec.get("type") != "snapshot":
            continue
        ts = rec.get("ts")
        assets = rec.get("assets", {})
        for asset, a in assets.items():
            books = a.get("books", {})
            for outcome, b in books.items():
                s = spread_for(b)
                key = (asset, outcome)
                if s is not None and s <= args.spread:
                    streak[key] += 1
                else:
                    streak[key] = 0

                if streak[key] >= args.streak:
                    now = time.time()
                    if now - last_alert_at.get(key, 0) >= args.cooldown:
                        last_alert_at[key] = now
                        print(
                            f"[REGIME] {ts} {asset} {outcome}: spread={s:.4f} <= {args.spread:.4f} for {streak[key]} snapshots | slug={a.get('slug')}"
                        )


if __name__ == "__main__":
    main()
