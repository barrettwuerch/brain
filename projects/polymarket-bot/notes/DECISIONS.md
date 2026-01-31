# Decisions / Context Log — Polymarket Bot

This file exists so project context doesn’t live only in chat.

## Current scope (Laptop MVP)
We are testing whether there is **tradeable** edge in Polymarket crypto **15-minute Up/Down** markets (BTC/ETH first) by exploiting potential lag vs spot.

Principle: **don’t fool ourselves**. Any backtest/paper sim must be *instrument-consistent* and conservative about fills.

## Key decisions (with rationale)

### D1 — Use best bid/ask (not last trade / midpoint)
- **Why:** last trade and “displayed probability” can look favorable while the market is actually untradeable due to wide spreads.
- **Implementation:** logger records best bid/ask; monitor/runner uses inside spread.

### D2 — Paper runner must bind to the same instrument across entry/exit
- **Why:** Polymarket 15m markets roll frequently; it’s easy to accidentally “exit” on the next window’s token, creating fake performance.
- **Implementation:** paper positions store `slug` + `token_id` and exits only if the same token exists.

### D3 — Conservative execution model (taker-by-default)
- **Why:** “Maker-ish” assumptions are a common source of false positives.
- **Implementation (current):** buy at ask, sell at bid, with size and depth gates.

### D4 — Time-to-expiry gate
- **Why:** entering too close to window end makes intended holding periods impossible and introduces rollover artifacts.
- **Implementation:** require `remaining_s >= hold_s + buffer_s` before entry.

### D5 — Staleness/skew matters
- **Why:** if spot and book are sampled at materially different times, the signal can be an illusion.
- **Implementation:** logger now includes `spot_fetch_ts_ms` and per-book `book_fetch_ts_ms`; runner gates on `max_skew_ms` and `max_book_age_ms`.

### D6 — Add a watchdog for silent failures
- **Why:** a monitor/logger that dies quietly is worse than useless.
- **Implementation:** regime-monitor emits `health: stale` when snapshots stop; emits `health: ok` once on recovery.

## Data contract (JSONL record shapes)

### Logger output highlights
- `type: snapshot`
  - `assets[asset].spot`
  - `assets[asset].spot_fetch_ts_ms`
  - `assets[asset].remaining_s`
  - `assets[asset].books[outcome]` includes:
    - `token_id`
    - `best_bid`, `best_ask`
    - `best_bid_size`, `best_ask_size`
    - `book_ts` (server timestamp if present)
    - `book_fetch_ts_ms` (local fetch timestamp)

### Regime monitor events
- `type: regime` includes top-of-book context:
  - `best_bid`, `best_ask`, `mid`, `spread`, `spread_bps`
- `type: health`
  - `status: stale|ok`

## Next planned work (high level)
1) Collect enough logs for meaningful OOS folds (non-zero trades) and run the walk-forward tuner regularly.
2) Add one major realism upgrade (VWAP-through-book fills) before believing any positive result.
3) Only then: tiny-live with strict risk caps and kill-switches (Bear approval required).

## Kill criteria (project stop-loss)
To avoid infinite tinkering, we stop this strategy direction if:
- after ~500+ slug windows the best out-of-sample net PnL is ≤ 0 (after fees), and
- there isn’t a single realism upgrade likely to improve results (our model is already conservative).

(Full PRD: `notes/PRD.md`)
