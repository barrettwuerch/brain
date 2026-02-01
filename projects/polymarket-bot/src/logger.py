#!/usr/bin/env python3
"""Polymarket 15m BTC+ETH orderbook + Coinbase spot logger.

Phase 1 MVP: log snapshots every N seconds.

Outputs JSONL lines to ./data/YYYY-MM-DD.jsonl

Notes:
- Polymarket market identity changes every 15 minutes (new event slug).
- We resolve current active slugs by scraping https://polymarket.com/crypto/15M
- We resolve CLOB token IDs via https://gamma-api.polymarket.com/events?slug=...
- We pull orderbooks via https://clob.polymarket.com/book?token_id=...

This is for research/paper-trading only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import re
import signal
import sys
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import requests

PM_15M_URL = "https://polymarket.com/crypto/15M"
GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events"
CLOB_BOOK_URL = "https://clob.polymarket.com/book"

COINBASE_TICKER = {
    "BTC": "https://api.exchange.coinbase.com/products/BTC-USD/ticker",
    "ETH": "https://api.exchange.coinbase.com/products/ETH-USD/ticker",
}

# Shared HTTP session + UA
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "openclaw-polymarket-bot/0.1", "Accept": "application/json"})

# Tunable HTTP behavior (set by CLI in main)
HTTP_TIMEOUT_S = 20
HTTP_TRIES = 3
HTTP_BACKOFF_S = 0.5
HTTP_JITTER_S = 0.25
HTTP_MAX_BACKOFF_S = 5.0


@dataclass
class MarketInfo:
    asset: str  # BTC or ETH
    slug: str
    title: str
    end_date: str
    token_ids: Dict[str, str]  # outcome -> token_id


def now_utc_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sleep_backoff(attempt: int, base_s: float, jitter_s: float, max_s: float) -> None:
    # attempt is 1-indexed
    s = min(max_s, base_s * (2 ** (attempt - 1)))
    if jitter_s:
        s += random.random() * jitter_s
    time.sleep(s)


def fetch_text(
    url: str,
    timeout: Optional[float] = None,
    tries: Optional[int] = None,
    backoff_s: Optional[float] = None,
    jitter_s: Optional[float] = None,
    max_backoff_s: Optional[float] = None,
) -> str:
    timeout = HTTP_TIMEOUT_S if timeout is None else timeout
    tries = HTTP_TRIES if tries is None else tries
    backoff_s = HTTP_BACKOFF_S if backoff_s is None else backoff_s
    jitter_s = HTTP_JITTER_S if jitter_s is None else jitter_s
    max_backoff_s = HTTP_MAX_BACKOFF_S if max_backoff_s is None else max_backoff_s

    last_err: Optional[Exception] = None
    for attempt in range(1, int(tries) + 1):
        try:
            r = SESSION.get(url, timeout=timeout)
            r.raise_for_status()
            return r.text
        except Exception as e:
            last_err = e
            if attempt < tries:
                sleep_backoff(attempt, backoff_s, jitter_s, max_backoff_s)
    raise RuntimeError(f"GET text failed after {tries} tries: {url}: {last_err}")


def fetch_json(
    url: str,
    params: Optional[dict] = None,
    timeout: Optional[float] = None,
    tries: Optional[int] = None,
    backoff_s: Optional[float] = None,
    jitter_s: Optional[float] = None,
    max_backoff_s: Optional[float] = None,
) -> dict:
    timeout = HTTP_TIMEOUT_S if timeout is None else timeout
    tries = HTTP_TRIES if tries is None else tries
    backoff_s = HTTP_BACKOFF_S if backoff_s is None else backoff_s
    jitter_s = HTTP_JITTER_S if jitter_s is None else jitter_s
    max_backoff_s = HTTP_MAX_BACKOFF_S if max_backoff_s is None else max_backoff_s

    last_err: Optional[Exception] = None
    for attempt in range(1, int(tries) + 1):
        try:
            r = SESSION.get(url, params=params, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_err = e
            if attempt < tries:
                sleep_backoff(attempt, backoff_s, jitter_s, max_backoff_s)
    raise RuntimeError(f"GET json failed after {tries} tries: {url}: {last_err}")


def get_current_15m_slugs(max_tries: int = 2) -> Dict[str, str]:
    """Return current event slugs for BTC and ETH.

    Primary method (robust): compute the 15-minute window start timestamp.
      slug pattern: <asset>-updown-15m-<windowStartEpochSeconds>

    Backup method: scrape https://polymarket.com/crypto/15M (can be flaky).
    """
    # Primary: compute window start in epoch seconds (UTC) rounded down to 15 minutes.
    window_start = int(time.time() // 900 * 900)
    computed = {
        "BTC": f"btc-updown-15m-{window_start}",
        "ETH": f"eth-updown-15m-{window_start}",
    }

    # Verify computed slugs exist (gamma returns [] if not found). Try current and previous window.
    for candidate_start in (window_start, window_start - 900):
        out: Dict[str, str] = {}
        for asset, sym in (("BTC", "btc"), ("ETH", "eth")):
            slug = f"{sym}-updown-15m-{candidate_start}"
            try:
                events = fetch_json(GAMMA_EVENTS_URL, params={"slug": slug})
                if events:
                    out[asset] = slug
            except Exception:
                pass
        if out:
            return out

    # Backup: scrape listing page.
    last_html = ""
    for attempt in range(1, max_tries + 1):
        try:
            last_html = fetch_text(PM_15M_URL)
            out = {}
            for sym in ("btc", "eth"):
                m = re.search(rf"/event/({sym}-updown-15m-\\d+)", last_html) or re.search(rf"({sym}-updown-15m-\\d+)", last_html)
                if m:
                    out[sym.upper()] = m.group(1)
            if out:
                return out
        except Exception:
            last_html = ""
        time.sleep(0.5 * attempt)

    details = {
        "computed": computed,
        "len": len(last_html or ""),
        "has_event": ("/event/" in (last_html or "")),
        "head": (last_html or "")[:200],
    }
    raise RuntimeError(f"Could not determine current 15m slugs. details={details}")


def get_market_info(asset: str, slug: str) -> MarketInfo:
    """Resolve a polymarket event slug into token ids for outcomes."""
    events = fetch_json(GAMMA_EVENTS_URL, params={"slug": slug})
    if not events:
        raise RuntimeError(f"No event found for slug={slug}")
    ev = events[0]
    markets = ev.get("markets") or []
    if not markets:
        raise RuntimeError(f"No markets in event slug={slug}")
    m0 = markets[0]

    outcomes = json.loads(m0["outcomes"])  # e.g. ["Up","Down"]
    token_ids_list = json.loads(m0["clobTokenIds"])  # aligned with outcomes
    if len(outcomes) != len(token_ids_list):
        raise RuntimeError(f"Outcome/token mismatch for {slug}")
    token_ids = {outcomes[i]: token_ids_list[i] for i in range(len(outcomes))}

    return MarketInfo(
        asset=asset,
        slug=slug,
        title=ev.get("title") or m0.get("question") or slug,
        end_date=ev.get("endDate") or m0.get("endDate") or "",
        token_ids=token_ids,
    )


def best_levels(book: dict) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]:
    """Return best bid/ask price and *size at those levels*.

    Do NOT assume the API returns bids/asks pre-sorted.
    """
    bids = book.get("bids") or []
    asks = book.get("asks") or []

    best_bid = None
    best_bid_sz = None
    for x in bids:
        try:
            p = float(x["price"])
            s = float(x.get("size") or 0)
        except Exception:
            continue
        if best_bid is None or p > best_bid:
            best_bid = p
            best_bid_sz = s

    best_ask = None
    best_ask_sz = None
    for x in asks:
        try:
            p = float(x["price"])
            s = float(x.get("size") or 0)
        except Exception:
            continue
        if best_ask is None or p < best_ask:
            best_ask = p
            best_ask_sz = s

    return best_bid, best_bid_sz, best_ask, best_ask_sz


def get_orderbook(token_id: str) -> dict:
    return fetch_json(CLOB_BOOK_URL, params={"token_id": token_id})


def seconds_remaining(now_iso: str, end_iso: str) -> Optional[int]:
    try:
        if end_iso.endswith('Z'):
            end_iso = end_iso.replace('Z', '+00:00')
        t_end = dt.datetime.fromisoformat(end_iso).timestamp()
        t_now = dt.datetime.fromisoformat(now_iso).timestamp()
        return int(t_end - t_now)
    except Exception:
        return None


def get_coinbase_spot(asset: str) -> Tuple[Optional[float], Optional[int]]:
    """Return (spot_price, fetch_ts_ms)."""
    url = COINBASE_TICKER[asset]
    try:
        j = fetch_json(url)
        price = float(j["price"])
        return price, int(time.time() * 1000)
    except Exception:
        return None, None


def ensure_data_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def run(poll_seconds: float, out_path: str, max_minutes: Optional[float], poll_jitter_s: float) -> None:
    ensure_data_dir(os.path.dirname(out_path))

    t0 = time.time()
    last_slugs: Dict[str, str] = {}
    market_cache: Dict[str, MarketInfo] = {}

    running = True

    def _stop(_signum=None, _frame=None):
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    snap_count = 0

    with open(out_path, "a", encoding="utf-8") as f:
        while running:
            if max_minutes is not None and (time.time() - t0) > max_minutes * 60:
                return

            # Refresh slugs each loop because they roll every 15 minutes.
            try:
                slugs = get_current_15m_slugs()
            except Exception as e:
                rec = {"ts": now_utc_iso(), "type": "error", "where": "get_current_15m_slugs", "error": str(e)}
                f.write(json.dumps(rec) + "\n")
                f.flush()
                sleep_s = poll_seconds + (random.random() * poll_jitter_s if poll_jitter_s else 0.0)
                time.sleep(sleep_s)
                continue

            for asset, slug in slugs.items():
                if last_slugs.get(asset) != slug:
                    # New window slug detected.
                    last_slugs[asset] = slug
                    try:
                        mi = get_market_info(asset, slug)
                        market_cache[asset] = mi
                        rec = {
                            "ts": now_utc_iso(),
                            "type": "rollover",
                            "asset": asset,
                            "slug": slug,
                            "title": mi.title,
                            "end_date": mi.end_date,
                            "token_ids": mi.token_ids,
                        }
                        f.write(json.dumps(rec) + "\n")
                        f.flush()
                    except Exception as e:
                        rec = {"ts": now_utc_iso(), "type": "error", "where": "get_market_info", "asset": asset, "slug": slug, "error": str(e)}
                        f.write(json.dumps(rec) + "\n")
                        f.flush()

            # Snapshot
            ts_iso = now_utc_iso()
            snap = {"ts": ts_iso, "type": "snapshot", "assets": {}}
            for asset in ("BTC", "ETH"):
                mi = market_cache.get(asset)
                if not mi:
                    continue
                spot, spot_fetch_ts_ms = get_coinbase_spot(asset)
                rem = seconds_remaining(ts_iso, mi.end_date) if mi.end_date else None
                asset_rec = {
                    "slug": mi.slug,
                    "title": mi.title,
                    "end_date": mi.end_date,
                    "remaining_s": rem,
                    "spot": spot,
                    "spot_fetch_ts_ms": spot_fetch_ts_ms,
                    "books": {},
                }
                if spot is None:
                    asset_rec["spot_error"] = "fetch_failed"

                for outcome, token_id in mi.token_ids.items():
                    try:
                        book = get_orderbook(token_id)
                        book_fetch_ts_ms = int(time.time() * 1000)
                        bid, bid_sz, ask, ask_sz = best_levels(book)
                        asset_rec["books"][outcome] = {
                            "token_id": token_id,
                            "best_bid": bid,
                            "best_bid_size": bid_sz,
                            "best_ask": ask,
                            "best_ask_size": ask_sz,
                            "bid_count": len(book.get("bids") or []),
                            "ask_count": len(book.get("asks") or []),
                            "book_ts": int(book.get("timestamp")) if book.get("timestamp") else None,
                            "book_fetch_ts_ms": book_fetch_ts_ms,
                        }
                    except Exception as e:
                        asset_rec["books"][outcome] = {"token_id": token_id, "error": str(e)}

                snap["assets"][asset] = asset_rec

            f.write(json.dumps(snap) + "\n")
            f.flush()
            snap_count += 1
            if snap_count % 60 == 0:
                # lightweight operator heartbeat
                try:
                    sz = os.path.getsize(out_path) / (1024 * 1024)
                    sys.stderr.write(f"[logger] {snap_count} snapshots | file={sz:.2f}MB | out={out_path}\n")
                except Exception:
                    pass

            sleep_s = poll_seconds + (random.random() * poll_jitter_s if poll_jitter_s else 0.0)
            time.sleep(sleep_s)


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--poll", type=float, default=2.0, help="Polling interval in seconds (default: 2.0)")
    ap.add_argument("--poll-jitter", type=float, default=0.3, help="Add up to N seconds of random jitter per poll (default: 0.3)")

    ap.add_argument("--http-timeout", type=float, default=20.0, help="HTTP request timeout seconds (default: 20)")
    ap.add_argument("--http-tries", type=int, default=3, help="HTTP retries (default: 3)")
    ap.add_argument("--http-backoff", type=float, default=0.5, help="HTTP backoff base seconds (default: 0.5)")
    ap.add_argument("--http-jitter", type=float, default=0.25, help="HTTP backoff jitter seconds (default: 0.25)")
    ap.add_argument("--http-max-backoff", type=float, default=5.0, help="HTTP backoff cap seconds (default: 5.0)")

    ap.add_argument("--out", type=str, default="", help="Output JSONL path (default: ./data/YYYY-MM-DD.jsonl)")
    ap.add_argument("--minutes", type=float, default=None, help="Run for N minutes then exit")
    args = ap.parse_args(argv)

    # Apply HTTP tuning
    global HTTP_TIMEOUT_S, HTTP_TRIES, HTTP_BACKOFF_S, HTTP_JITTER_S, HTTP_MAX_BACKOFF_S
    HTTP_TIMEOUT_S = float(args.http_timeout)
    HTTP_TRIES = int(args.http_tries)
    HTTP_BACKOFF_S = float(args.http_backoff)
    HTTP_JITTER_S = float(args.http_jitter)
    HTTP_MAX_BACKOFF_S = float(args.http_max_backoff)

    if args.out:
        out_path = args.out
    else:
        day = dt.datetime.now().strftime("%Y-%m-%d")
        out_path = os.path.join(os.path.dirname(__file__), "..", "data", f"{day}.jsonl")
        out_path = os.path.abspath(out_path)

    run(poll_seconds=args.poll, out_path=out_path, max_minutes=args.minutes, poll_jitter_s=float(args.poll_jitter))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
