#!/usr/bin/env python3
"""Summarize Polymarket bot logger JSONL.

Outputs a quick markdown summary: spreads, best bid/ask snapshots, spot availability.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import defaultdict


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="Path to JSONL file")
    args = ap.parse_args()

    spreads = defaultdict(list)  # key: (asset,outcome)
    spot_ok = defaultdict(int)
    spot_total = defaultdict(int)
    n_snap = 0

    with open(args.path, "r", encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            if rec.get("type") != "snapshot":
                continue
            n_snap += 1
            for asset, a in rec.get("assets", {}).items():
                spot_total[asset] += 1
                if a.get("spot") is not None:
                    spot_ok[asset] += 1
                for outcome, b in a.get("books", {}).items():
                    bid = b.get("best_bid")
                    ask = b.get("best_ask")
                    if bid is None or ask is None:
                        continue
                    spreads[(asset, outcome)].append(float(ask) - float(bid))

    print(f"# Polymarket Logger Summary\n")
    print(f"Snapshots: {n_snap}\n")

    for asset in sorted(spot_total.keys()):
        ok = spot_ok[asset]
        tot = spot_total[asset]
        pct = (ok / tot * 100) if tot else 0
        print(f"- {asset} spot from Coinbase: {ok}/{tot} ({pct:.1f}%)")

    print("\n## Spreads (ask - bid)\n")
    for (asset, outcome), vals in sorted(spreads.items()):
        if not vals:
            continue
        p50 = statistics.median(vals)
        p90 = statistics.quantiles(vals, n=10)[8] if len(vals) >= 10 else max(vals)
        mx = max(vals)
        print(f"- {asset} {outcome}: median={p50:.4f}, p90={p90:.4f}, max={mx:.4f} (n={len(vals)})")


if __name__ == "__main__":
    main()
