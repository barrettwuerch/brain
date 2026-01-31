#!/usr/bin/env python3
"""Paper trading runner for the Polymarket 15m BTC/ETH Up/Down bot.

Replays JSONL output from logger.py and simulates a simple lag-catcher strategy.

Defaults are intentionally conservative:
- enter by buying at best_ask (taker)
- exit by selling at best_bid (taker)

This is NOT financial advice.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, List, Optional, Tuple


@dataclass
class Position:
    asset: str
    side: str  # "Up" or "Down"
    entry_ts: float
    entry_px: float


def parse_ts_iso(ts: str) -> float:
    # ts like 2026-01-31T15:54:15.150397+00:00
    return dt.datetime.fromisoformat(ts).timestamp()


def get_bid_ask(snapshot_asset: dict, outcome: str) -> Tuple[Optional[float], Optional[float]]:
    b = snapshot_asset.get("books", {}).get(outcome, {})
    return b.get("best_bid"), b.get("best_ask")


def run(path: str,
        spread_max: float,
        horizon_s: int,
        ret_threshold: float,
        hold_s: int,
        stop_spread: float,
        min_depth: float,
        fee_bps: float,
        ) -> dict:

    # Rolling spot history per asset
    spot_hist: Dict[str, Deque[Tuple[float, float]]] = {
        "BTC": deque(maxlen=2000),
        "ETH": deque(maxlen=2000),
    }

    pos: Dict[str, Optional[Position]] = {"BTC": None, "ETH": None}
    trades: List[dict] = []

    def spot_n_seconds_ago(asset: str, t: float, n: int) -> Optional[float]:
        # find the closest sample <= t-n
        target = t - n
        h = spot_hist[asset]
        # iterate from right to left (newest first)
        for ts, px in reversed(h):
            if ts <= target:
                return px
        return None

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            if rec.get("type") != "snapshot":
                continue

            t_iso = rec["ts"]
            t = parse_ts_iso(t_iso)

            for asset, a in rec.get("assets", {}).items():
                spot = a.get("spot")
                if spot is None:
                    continue
                spot_hist[asset].append((t, float(spot)))

                # Manage exit
                if pos[asset] is not None:
                    p = pos[asset]
                    if t - p.entry_ts >= hold_s:
                        bid, ask = get_bid_ask(a, p.side)
                        if bid is None:
                            continue
                        exit_px = float(bid)  # taker sell
                        gross = exit_px - p.entry_px
                        # fees modeled as bps on notional both sides
                        fee = (fee_bps / 10000.0) * (p.entry_px + exit_px)
                        net = gross - fee
                        trades.append({
                            "asset": asset,
                            "side": p.side,
                            "entry_ts": p.entry_ts,
                            "exit_ts": t,
                            "entry_px": p.entry_px,
                            "exit_px": exit_px,
                            "gross": gross,
                            "fee": fee,
                            "net": net,
                        })
                        pos[asset] = None
                        continue

                # No entry if we’re already in
                if pos[asset] is not None:
                    continue

                # Signal: spot return over horizon
                past = spot_n_seconds_ago(asset, t, horizon_s)
                if past is None:
                    continue
                r = (float(spot) - past) / past
                if abs(r) < ret_threshold:
                    continue

                preferred = "Up" if r > 0 else "Down"

                # Tradable gates on preferred token
                bid, ask = get_bid_ask(a, preferred)
                if bid is None or ask is None:
                    continue
                bid = float(bid)
                ask = float(ask)
                spread = ask - bid
                if spread > spread_max:
                    continue

                # depth gates (best level size)
                book = a.get("books", {}).get(preferred, {})
                # logger currently doesn’t store size at best levels; use count as weak proxy
                # for now, require both sides have at least some levels
                if (book.get("bid_count", 0) < 5) or (book.get("ask_count", 0) < 5):
                    continue

                # stop condition: if the opposite token looks unhealthy (spread blowout)
                other = "Down" if preferred == "Up" else "Up"
                obid, oask = get_bid_ask(a, other)
                if obid is not None and oask is not None:
                    if float(oask) - float(obid) > stop_spread:
                        continue

                # Enter (taker buy)
                entry_px = ask
                pos[asset] = Position(asset=asset, side=preferred, entry_ts=t, entry_px=entry_px)

    # Compute summary
    nets = [t["net"] for t in trades]
    gross = [t["gross"] for t in trades]

    def stats(xs: List[float]) -> dict:
        if not xs:
            return {"n": 0}
        xs2 = sorted(xs)
        return {
            "n": len(xs),
            "sum": sum(xs2),
            "mean": sum(xs2) / len(xs2),
            "min": xs2[0],
            "p50": xs2[len(xs2)//2],
            "p90": xs2[int(0.9*(len(xs2)-1))],
            "max": xs2[-1],
            "win_rate": sum(1 for x in xs2 if x > 0) / len(xs2),
        }

    return {
        "params": {
            "spread_max": spread_max,
            "horizon_s": horizon_s,
            "ret_threshold": ret_threshold,
            "hold_s": hold_s,
            "stop_spread": stop_spread,
            "fee_bps": fee_bps,
        },
        "trades": trades,
        "net": stats(nets),
        "gross": stats(gross),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="Path to logger JSONL")
    ap.add_argument("--spread-max", type=float, default=0.03)
    ap.add_argument("--horizon", type=int, default=40)
    ap.add_argument("--ret", type=float, default=0.0008)
    ap.add_argument("--hold", type=int, default=40)
    ap.add_argument("--stop-spread", type=float, default=0.10)
    ap.add_argument("--min-depth", type=float, default=0.0)
    ap.add_argument("--fee-bps", type=float, default=0.0)
    ap.add_argument("--out", type=str, default="")
    args = ap.parse_args()

    res = run(
        path=args.path,
        spread_max=args.spread_max,
        horizon_s=args.horizon,
        ret_threshold=args.ret,
        hold_s=args.hold,
        stop_spread=args.stop_spread,
        min_depth=args.min_depth,
        fee_bps=args.fee_bps,
    )

    lines=[]
    lines.append('# Paper Runner Report')
    lines.append('')
    lines.append(f"Input: `{args.path}`")
    lines.append('')
    lines.append('## Params')
    for k,v in res['params'].items():
        lines.append(f"- {k}: {v}")
    lines.append('')
    lines.append('## Net stats (after fees)')
    lines.append(str(res['net']))
    lines.append('')
    lines.append('## Gross stats (before fees)')
    lines.append(str(res['gross']))
    lines.append('')
    lines.append(f"Trades simulated: {len(res['trades'])}")

    out='\n'.join(lines)
    if args.out:
        open(args.out,'w',encoding='utf-8').write(out)
    else:
        print(out)


if __name__ == '__main__':
    main()
