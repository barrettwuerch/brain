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
from collections import deque, defaultdict
from dataclasses import dataclass
from typing import Deque, Dict, List, Optional, Tuple, Literal


@dataclass
class Position:
    asset: str
    side: str  # "Up" or "Down"
    slug: str
    token_id: str
    entry_ts: float
    entry_px: float
    remaining_s_at_entry: Optional[int]
    size: float


def parse_ts_iso(ts: str) -> float:
    # ts like 2026-01-31T15:54:15.150397+00:00
    return dt.datetime.fromisoformat(ts).timestamp()


def get_book(snapshot_asset: dict, outcome: str) -> dict:
    return snapshot_asset.get("books", {}).get(outcome, {})


def get_bid_ask(snapshot_asset: dict, outcome: str) -> Tuple[Optional[float], Optional[float]]:
    b = get_book(snapshot_asset, outcome)
    return b.get("best_bid"), b.get("best_ask")


def get_book_by_token(snapshot_asset: dict, token_id: str) -> Optional[dict]:
    for out, b in (snapshot_asset.get("books", {}) or {}).items():
        if b.get("token_id") == token_id:
            return b
    return None


FeeModel = Literal["flat", "curve", "none"]

# price -> effective fee bps (anchored to Polymarket docs for fee_rate_bps=1000)
FEE_ANCHOR = [
    (0.10, 20),
    (0.20, 65),
    (0.30, 110),
    (0.40, 145),
    (0.50, 156),
    (0.60, 143),
    (0.70, 110),
    (0.80, 64),
    (0.90, 20),
]


def interp_effective_bps(px: float) -> float:
    """Effective fee bps for fee_rate_bps=1000, interpolated from docs table."""
    if px <= FEE_ANCHOR[0][0]:
        return float(FEE_ANCHOR[0][1])
    if px >= FEE_ANCHOR[-1][0]:
        return float(FEE_ANCHOR[-1][1])

    for (p0, b0), (p1, b1) in zip(FEE_ANCHOR, FEE_ANCHOR[1:]):
        if p0 <= px <= p1:
            t = (px - p0) / (p1 - p0)
            return float(b0 + t * (b1 - b0))
    return float(FEE_ANCHOR[-1][1])


def curve_effective_bps(px: float, fee_rate_bps: int) -> float:
    """Scale the doc curve by fee_rate_bps/1000.

    Note: Polymarket's `fee_rate_bps` is a required signing parameter;
    docs provide example effective rates for fee_rate_bps=1000.
    """
    base = interp_effective_bps(px)
    return base * (fee_rate_bps / 1000.0)


def taker_fee_usdc(px: float, shares: float, fee_model: FeeModel, fee_bps: float, fee_rate_bps: int) -> float:
    """Fee in USDC for one taker leg at price px and quantity shares."""
    notional = float(px) * float(shares)
    if fee_model == "none":
        return 0.0
    if fee_model == "flat":
        return (fee_bps / 10_000.0) * notional
    # curve
    bps = curve_effective_bps(float(px), int(fee_rate_bps))
    return (bps / 10_000.0) * notional


def run(path: str,
        spread_max: float,
        horizon_s: int,
        ret_threshold: float,
        hold_s: int,
        stop_spread: float,
        min_depth: float,
        fee_model: FeeModel,
        fee_bps: float,
        fee_rate_bps: int,
        size: float,
        buffer_s: int,
        max_skew_ms: int,
        max_book_age_ms: int,
        decision_lag_s: int,
        ) -> dict:

    # Rolling spot history per asset
    spot_hist: Dict[str, Deque[Tuple[float, float]]] = {
        "BTC": deque(maxlen=2000),
        "ETH": deque(maxlen=2000),
    }

    pos: Dict[str, Optional[Position]] = {"BTC": None, "ETH": None}
    trades: List[dict] = []
    rejects = defaultdict(int)
    rollover_cross = 0
    exit_missing_book = 0
    skew_ms = []
    book_age_ms = []

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
                        # must exit on the SAME token_id; otherwise treat as failure
                        if a.get("slug") != p.slug:
                            rollover_cross += 1
                        b = get_book_by_token(a, p.token_id)
                        if not b:
                            exit_missing_book += 1
                            # conservative: treat as catastrophic liquidity/rollover failure
                            trades.append({
                                "asset": asset,
                                "side": p.side,
                                "entry_ts": p.entry_ts,
                                "exit_ts": t,
                                "entry_px": p.entry_px,
                                "exit_px": 0.0,
                                "gross": -p.entry_px * p.size,
                                "fee": taker_fee_usdc(p.entry_px, p.size, fee_model, fee_bps, fee_rate_bps),
                                "net": (-p.entry_px * p.size) - taker_fee_usdc(p.entry_px, p.size, fee_model, fee_bps, fee_rate_bps),
                                "entry_slug": p.slug,
                                "exit_slug": a.get("slug"),
                                "token_id": p.token_id,
                                "exit_fail": True,
                            })
                            pos[asset] = None
                            continue

                        bid = b.get("best_bid")
                        bid_sz = b.get("best_bid_size")
                        if bid is None:
                            rejects["exit_no_bid"] += 1
                            continue
                        if bid_sz is not None and float(bid_sz) < p.size:
                            rejects["exit_depth"] += 1
                            continue

                        exit_px = float(bid)  # taker sell
                        gross = (exit_px - p.entry_px) * p.size
                        fee = taker_fee_usdc(p.entry_px, p.size, fee_model, fee_bps, fee_rate_bps) + taker_fee_usdc(exit_px, p.size, fee_model, fee_bps, fee_rate_bps)
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
                            "entry_slug": p.slug,
                            "exit_slug": a.get("slug"),
                            "token_id": p.token_id,
                            "exit_fail": False,
                        })
                        pos[asset] = None
                        continue

                # No entry if we’re already in
                if pos[asset] is not None:
                    continue

                # Remaining-time gate
                remaining_s = a.get("remaining_s")
                if remaining_s is None or int(remaining_s) < (hold_s + buffer_s):
                    rejects["remaining_time"] += 1
                    continue

                # Timestamp skew + recency gates (if present)
                spot_fetch = a.get("spot_fetch_ts_ms")

                # Signal: spot return over horizon (optionally lagged)
                # If decision_lag_s > 0, we simulate slower reaction by computing the signal
                # using spot history as-of (t - decision_lag_s), while still executing at time t.
                t_sig = t - float(decision_lag_s)
                past = spot_n_seconds_ago(asset, t_sig, horizon_s)
                if past is None:
                    rejects["no_spot_history"] += 1
                    continue
                # Use spot at (t - decision_lag_s) for the signal.
                spot_sig = spot_n_seconds_ago(asset, t, decision_lag_s) if decision_lag_s > 0 else float(spot)
                if spot_sig is None:
                    rejects["no_spot_history"] += 1
                    continue
                r = (float(spot_sig) - past) / past
                if abs(r) < ret_threshold:
                    rejects["no_signal"] += 1
                    continue

                preferred = "Up" if r > 0 else "Down"
                book = get_book(a, preferred)

                bid = book.get("best_bid")
                ask = book.get("best_ask")
                if bid is None or ask is None:
                    rejects["no_bidask"] += 1
                    continue
                bid = float(bid)
                ask = float(ask)
                spread = ask - bid
                if spread > spread_max:
                    rejects["spread"] += 1
                    continue

                # depth gate: use best-level sizes
                bsz = book.get("best_bid_size")
                asz = book.get("best_ask_size")
                if bsz is not None and float(bsz) < max(min_depth, size):
                    rejects["depth_bid"] += 1
                    continue
                if asz is not None and float(asz) < max(min_depth, size):
                    rejects["depth_ask"] += 1
                    continue

                # skew gate (needs book_fetch_ts_ms)
                book_fetch = book.get("book_fetch_ts_ms")
                if spot_fetch is not None and book_fetch is not None:
                    skew = abs(int(spot_fetch) - int(book_fetch))
                    skew_ms.append(skew)
                    if skew > max_skew_ms:
                        rejects["skew"] += 1
                        continue

                # book age gate (needs book_ts and snapshot ts)
                bts = book.get("book_ts")
                if bts is not None:
                    age = abs(int(book_fetch or (t * 1000)) - int(bts))
                    book_age_ms.append(age)
                    if age > max_book_age_ms:
                        rejects["book_age"] += 1
                        continue

                # stop condition: if the opposite token looks unhealthy (spread blowout)
                other = "Down" if preferred == "Up" else "Up"
                obid, oask = get_bid_ask(a, other)
                if obid is not None and oask is not None:
                    if float(oask) - float(obid) > stop_spread:
                        rejects["other_spread"] += 1
                        continue

                # Enter (taker buy)
                entry_px = ask
                token_id = book.get("token_id")
                if not token_id:
                    rejects["no_token_id"] += 1
                    continue
                pos[asset] = Position(
                    asset=asset,
                    side=preferred,
                    slug=a.get("slug"),
                    token_id=token_id,
                    entry_ts=t,
                    entry_px=entry_px,
                    remaining_s_at_entry=int(remaining_s) if remaining_s is not None else None,
                    size=size,
                )

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

    def stats_int(xs: List[int]) -> dict:
        if not xs:
            return {"n": 0}
        xs2 = sorted(xs)
        return {
            "n": len(xs2),
            "min": xs2[0],
            "p50": xs2[len(xs2)//2],
            "p90": xs2[int(0.9*(len(xs2)-1))],
            "max": xs2[-1],
        }

    return {
        "params": {
            "spread_max": spread_max,
            "horizon_s": horizon_s,
            "ret_threshold": ret_threshold,
            "hold_s": hold_s,
            "stop_spread": stop_spread,
            "min_best_size": min_depth,
            "size": size,
            "buffer_s": buffer_s,
            "max_skew_ms": max_skew_ms,
            "max_book_age_ms": max_book_age_ms,
            "fee_model": fee_model,
            "fee_bps": fee_bps,
            "fee_rate_bps": fee_rate_bps,
            "decision_lag_s": decision_lag_s,
        },
        "trades": trades,
        "rejects": dict(rejects),
        "rollover_cross": rollover_cross,
        "exit_missing_book": exit_missing_book,
        "skew_ms": stats_int(skew_ms),
        "book_age_ms": stats_int(book_age_ms),
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
    ap.add_argument("--min-depth", type=float, default=0.0, help="Minimum best-level size gate (shares)")
    ap.add_argument("--size", type=float, default=10.0, help="Simulated trade size in shares (default 10)")
    ap.add_argument("--buffer", type=int, default=10, help="Seconds buffer before window end (default 10)")
    ap.add_argument("--max-skew-ms", type=int, default=1500, help="Max allowed spot vs book fetch skew (ms)")
    ap.add_argument("--max-book-age-ms", type=int, default=5000, help="Max allowed book timestamp age (ms)")

    ap.add_argument("--fee-model", choices=("flat", "curve", "none"), default="flat",
                    help="Fee model: flat (uses --fee-bps), curve (uses --fee-rate-bps), or none")
    ap.add_argument("--fee-bps", type=float, default=0.0, help="Flat fee bps (used when --fee-model flat)")
    ap.add_argument("--fee-rate-bps", type=int, default=1000,
                    help="Polymarket feeRateBps parameter (used when --fee-model curve; docs show curve for 1000)")

    ap.add_argument("--decision-lag", type=int, default=0,
                    help="Simulated reaction delay in seconds: signal uses data as-of (t-decision_lag) but execution stays at t")

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
        fee_model=args.fee_model,
        fee_bps=args.fee_bps,
        fee_rate_bps=args.fee_rate_bps,
        size=args.size,
        buffer_s=args.buffer,
        max_skew_ms=args.max_skew_ms,
        max_book_age_ms=args.max_book_age_ms,
        decision_lag_s=args.decision_lag,
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
    lines.append('## Integrity / gating')
    lines.append(f"- rollover_cross: {res.get('rollover_cross')}")
    lines.append(f"- exit_missing_book: {res.get('exit_missing_book')}")
    lines.append(f"- skew_ms: {res.get('skew_ms')}")
    lines.append(f"- book_age_ms: {res.get('book_age_ms')}")
    lines.append('')
    lines.append('## Rejects (why trades were skipped)')
    lines.append(str(res.get('rejects', {})))
    lines.append('')
    lines.append(f"Trades simulated: {len(res['trades'])}")

    out='\n'.join(lines)
    if args.out:
        open(args.out,'w',encoding='utf-8').write(out)
    else:
        print(out)


if __name__ == '__main__':
    main()
