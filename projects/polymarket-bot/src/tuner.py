#!/usr/bin/env python3
"""Walk-forward / out-of-sample tuner for polymarket-bot.

Goal: avoid overfitting by evaluating parameter sets on *future* 15m windows.

Design notes: projects/polymarket-bot/notes/walkforward-tuner.md

This is a minimal MVP:
- loads logger JSONL
- groups by (asset, slug)
- creates time-ordered walk-forward folds
- for each fold and param set, runs paper_runner on train/test splits
- outputs a JSON + markdown report

Usage (from projects/polymarket-bot/):
  python3 -m src.tuner --jsonl data/2026-01-31.jsonl --out-name wf1

Optionally provide a param grid JSON:
  python3 -m src.tuner --jsonl data/2026-01-31.jsonl --grid notes/grid.json

Grid format:
{
  "spread_max": [0.02, 0.03],
  "horizon_s": [20, 40],
  "ret_threshold": [0.0008],
  "hold_s": [20, 40]
}

All unspecified params default to paper_runner defaults.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib
import itertools
import json
import os
import tempfile
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class Row:
    ts_iso: str
    ts: float
    asset: str
    slug: str
    raw: dict


def parse_ts_iso(ts: str) -> float:
    return dt.datetime.fromisoformat(ts).timestamp()


def load_rows(jsonl_path: str) -> List[Row]:
    rows: List[Row] = []
    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if rec.get("type") != "snapshot":
                continue
            ts_iso = rec.get("ts")
            if not ts_iso:
                continue
            try:
                ts = parse_ts_iso(ts_iso)
            except Exception:
                continue
            assets = rec.get("assets") or {}
            for asset, a in assets.items():
                slug = a.get("slug")
                if not slug:
                    continue
                rows.append(Row(ts_iso=ts_iso, ts=ts, asset=str(asset), slug=str(slug), raw=rec))
    # Ensure time order
    rows.sort(key=lambda r: (r.asset, r.ts, r.slug))
    return rows


def list_groups(rows: Sequence[Row]) -> List[Tuple[str, str, float, float]]:
    """Return (asset, slug, start_ts, end_ts) groups."""
    by: Dict[Tuple[str, str], List[float]] = {}
    for r in rows:
        by.setdefault((r.asset, r.slug), []).append(r.ts)

    out = []
    for (asset, slug), ts_list in by.items():
        out.append((asset, slug, min(ts_list), max(ts_list)))

    out.sort(key=lambda x: (x[0], x[2]))
    return out


def make_walkforward_folds(
    groups: Sequence[Tuple[str, str, float, float]],
    train_windows: int,
    test_windows: int,
    step_windows: int,
) -> List[dict]:
    """Create folds per asset over ordered slug windows.

    groups: list of (asset, slug, start_ts, end_ts) sorted by (asset, start_ts)

    Returns fold dicts:
      {asset, train_slugs, test_slugs}
    """
    by_asset: Dict[str, List[str]] = {}
    for asset, slug, _, _ in groups:
        by_asset.setdefault(asset, []).append(slug)

    folds: List[dict] = []
    for asset, slugs in by_asset.items():
        i = 0
        while i + train_windows + test_windows <= len(slugs):
            train_slugs = slugs[i : i + train_windows]
            test_slugs = slugs[i + train_windows : i + train_windows + test_windows]
            folds.append({"asset": asset, "train_slugs": train_slugs, "test_slugs": test_slugs})
            i += step_windows

    return folds


def iter_param_grid(grid: Dict[str, list]) -> Iterator[Dict[str, Any]]:
    keys = sorted(grid.keys())
    vals = [grid[k] for k in keys]
    for combo in itertools.product(*vals):
        yield {k: v for k, v in zip(keys, combo)}


def default_grid() -> Dict[str, list]:
    # Tight-ish grid; keep manageable.
    return {
        "spread_max": [0.02, 0.03],
        "horizon_s": [20, 40],
        "ret_threshold": [0.0008],
        "hold_s": [20, 40],
        "stop_spread": [0.10],
        "min_depth": [10.0],
        "fee_model": ["curve"],
        "fee_rate_bps": [1000],
        "size": [10.0],
        "buffer_s": [10],
        "max_skew_ms": [1500],
        "max_book_age_ms": [5000],
    }


def write_filtered_jsonl(in_path: str, out_path: str, asset: str, slugs: Sequence[str]) -> int:
    slugs_set = set(slugs)
    n = 0
    with open(in_path, "r", encoding="utf-8") as fin, open(out_path, "w", encoding="utf-8") as fout:
        for line in fin:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if rec.get("type") != "snapshot":
                continue
            a = (rec.get("assets") or {}).get(asset)
            if not a:
                continue
            if a.get("slug") not in slugs_set:
                continue
            fout.write(json.dumps(rec) + "\n")
            n += 1
    return n


def extract_score(res: dict, key: str) -> float:
    # res['net'] is stats dict with sum/mean/etc.
    if key == "net_sum":
        return float((res.get("net") or {}).get("sum") or 0.0)
    if key == "net_mean":
        return float((res.get("net") or {}).get("mean") or 0.0)
    if key == "net_min":
        return float((res.get("net") or {}).get("min") or 0.0)
    if key == "net_p50":
        return float((res.get("net") or {}).get("p50") or 0.0)
    raise ValueError(f"Unknown score key: {key}")


def run_fold(
    jsonl_path: str,
    paper_runner_mod: str,
    asset: str,
    train_slugs: Sequence[str],
    test_slugs: Sequence[str],
    params: Dict[str, Any],
    score_key: str,
    min_test_trades: int,
) -> dict:
    pr = importlib.import_module(paper_runner_mod)

    with tempfile.TemporaryDirectory(prefix="pmwf-") as td:
        train_path = os.path.join(td, "train.jsonl")
        test_path = os.path.join(td, "test.jsonl")

        n_train = write_filtered_jsonl(jsonl_path, train_path, asset=asset, slugs=train_slugs)
        n_test = write_filtered_jsonl(jsonl_path, test_path, asset=asset, slugs=test_slugs)

        # Map tuner params to paper_runner.run signature (ours is stable).
        res_train = pr.run(
            path=train_path,
            spread_max=float(params.get("spread_max", 0.03)),
            horizon_s=int(params.get("horizon_s", 40)),
            ret_threshold=float(params.get("ret_threshold", 0.0008)),
            hold_s=int(params.get("hold_s", 40)),
            stop_spread=float(params.get("stop_spread", 0.10)),
            min_depth=float(params.get("min_depth", 0.0)),
            fee_model=str(params.get("fee_model", "flat")),
            fee_bps=float(params.get("fee_bps", 0.0)),
            fee_rate_bps=int(params.get("fee_rate_bps", 1000)),
            size=float(params.get("size", 10.0)),
            buffer_s=int(params.get("buffer_s", 10)),
            max_skew_ms=int(params.get("max_skew_ms", 1500)),
            max_book_age_ms=int(params.get("max_book_age_ms", 5000)),
        )

        res_test = pr.run(
            path=test_path,
            spread_max=float(params.get("spread_max", 0.03)),
            horizon_s=int(params.get("horizon_s", 40)),
            ret_threshold=float(params.get("ret_threshold", 0.0008)),
            hold_s=int(params.get("hold_s", 40)),
            stop_spread=float(params.get("stop_spread", 0.10)),
            min_depth=float(params.get("min_depth", 0.0)),
            fee_model=str(params.get("fee_model", "flat")),
            fee_bps=float(params.get("fee_bps", 0.0)),
            fee_rate_bps=int(params.get("fee_rate_bps", 1000)),
            size=float(params.get("size", 10.0)),
            buffer_s=int(params.get("buffer_s", 10)),
            max_skew_ms=int(params.get("max_skew_ms", 1500)),
            max_book_age_ms=int(params.get("max_book_age_ms", 5000)),
        )

        train_trades = len(res_train.get("trades") or [])
        test_trades = len(res_test.get("trades") or [])

        test_score = extract_score(res_test, score_key)
        # Zero-trade folds are a *signal*; treat as invalid if below minimum.
        if test_trades < int(min_test_trades):
            test_score = float("-inf")

        return {
            "asset": asset,
            "train_slugs": list(train_slugs),
            "test_slugs": list(test_slugs),
            "n_train": n_train,
            "n_test": n_test,
            "train": {
                "score": extract_score(res_train, score_key),
                "net": res_train.get("net"),
                "gross": res_train.get("gross"),
                "rejects": res_train.get("rejects"),
                "trades": train_trades,
            },
            "test": {
                "score": test_score,
                "net": res_test.get("net"),
                "gross": res_test.get("gross"),
                "rejects": res_test.get("rejects"),
                "trades": test_trades,
                "min_trades_required": int(min_test_trades),
                "valid": test_trades >= int(min_test_trades),
            },
        }


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jsonl", required=True, help="Path to logger JSONL")
    ap.add_argument("--grid", default="", help="Optional grid JSON path")
    ap.add_argument("--out-name", default="walkforward", help="Output basename (no extension)")
    ap.add_argument("--paper-runner", default="src.paper_runner", help="Module path with run()")

    ap.add_argument("--train-windows", type=int, default=8, help="Number of 15m slugs in train")
    ap.add_argument("--test-windows", type=int, default=2, help="Number of 15m slugs in test")
    ap.add_argument("--step-windows", type=int, default=2, help="Stride in 15m slugs")

    ap.add_argument("--score", choices=("net_sum", "net_mean", "net_min", "net_p50"), default="net_sum")
    ap.add_argument("--min-test-trades", type=int, default=1,
                    help="Require at least this many test trades per fold; otherwise fold score is treated as -inf")

    args = ap.parse_args(list(argv) if argv is not None else None)

    if args.grid:
        grid = json.loads(open(args.grid, "r", encoding="utf-8").read())
    else:
        grid = default_grid()

    rows = load_rows(args.jsonl)
    groups = list_groups(rows)
    folds = make_walkforward_folds(groups, args.train_windows, args.test_windows, args.step_windows)

    results = {
        "input": args.jsonl,
        "paper_runner": args.paper_runner,
        "grid": grid,
        "fold_params": {
            "train_windows": args.train_windows,
            "test_windows": args.test_windows,
            "step_windows": args.step_windows,
        },
        "score": args.score,
        "folds": [],
        "summary": {},
    }

    # Evaluate
    all_param_results: List[dict] = []
    for params in iter_param_grid(grid):
        param_key = json.dumps(params, sort_keys=True)
        fold_scores = []
        fold_details = []
        for fold in folds:
            fr = run_fold(
                jsonl_path=args.jsonl,
                paper_runner_mod=args.paper_runner,
                asset=fold["asset"],
                train_slugs=fold["train_slugs"],
                test_slugs=fold["test_slugs"],
                params=params,
                score_key=args.score,
                min_test_trades=args.min_test_trades,
            )
            fold_details.append(fr)
            fold_scores.append(fr["test"]["score"])

        # Filter -inf (invalid folds) out of mean; also track validity ratio.
        valid_scores = [s for s in fold_scores if s != float("-inf")]
        valid_fold_ratio = (len(valid_scores) / len(fold_scores)) if fold_scores else 0.0

        all_param_results.append(
            {
                "params": params,
                "param_key": param_key,
                "fold_test_scores": fold_scores,
                "valid_fold_ratio": valid_fold_ratio,
                "mean_test_score": (sum(valid_scores) / len(valid_scores)) if valid_scores else float("-inf"),
                "folds": fold_details,
            }
        )

    all_param_results.sort(key=lambda x: x["mean_test_score"], reverse=True)

    results["results"] = all_param_results[:50]  # cap
    results["summary"] = {
        "num_rows": len(rows),
        "num_groups": len(groups),
        "num_folds": len(folds),
        "num_param_sets": len(list(iter_param_grid(grid))),
        "best_mean_test_score": all_param_results[0]["mean_test_score"] if all_param_results else 0.0,
        "best_params": all_param_results[0]["params"] if all_param_results else None,
    }

    out_dir = os.path.join(os.path.dirname(__file__), "..", "reports")
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    out_json = os.path.join(out_dir, f"{args.out_name}.json")
    out_md = os.path.join(out_dir, f"{args.out_name}.md")

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, sort_keys=True)

    lines = []
    lines.append("# Walk-forward Tuner Report")
    lines.append("")
    lines.append(f"Input: `{args.jsonl}`")
    lines.append(f"Paper runner: `{args.paper_runner}`")
    lines.append("")
    lines.append("## Summary")
    for k, v in results["summary"].items():
        lines.append(f"- {k}: {v}")
    lines.append("")
    lines.append("## Top parameter sets (by mean test score)")
    for i, r in enumerate(all_param_results[:10]):
        lines.append("")
        lines.append(f"### Rank {i+1}: mean_test_score={r['mean_test_score']}")
        lines.append("```json")
        lines.append(json.dumps(r["params"], indent=2, sort_keys=True))
        lines.append("```")

    with open(out_md, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"Wrote: {out_md}")
    print(f"Wrote: {out_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
