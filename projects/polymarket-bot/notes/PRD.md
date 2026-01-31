# PRD — Polymarket 15m Crypto Bot (Laptop MVP)

**Status:** MVP components built; currently collecting longer logs for meaningful walk‑forward evaluation.

This PRD is the canonical product spec (updated with Claude review callouts).

## 0) Hypothesis (falsifiable) + timeline

### Hypothesis
We hypothesize that **Polymarket CLOB prices** for **15‑minute BTC/ETH Up/Down** markets **lag spot** by a sufficient margin that a conservative taker strategy can achieve **positive net PnL after fees and realistic execution frictions** in a measurable fraction of 15‑minute windows.

Concretely, we’re looking for:
- **Positive out‑of‑sample (OOS) net PnL** after taker fees, using conservative fills.
- **Non-trivial trade frequency** (not “0 trades forever”).

### Timeline to first OOS verdict
- **Initial verdict:** after ~**2–7 days** of logging (enough slugs to form folds with non-zero trades).
- **Confident verdict:** after **500+ slug windows** (order of weeks if logging continuously).

## 1) Executive summary
Build an “honesty-first” research system to test whether there’s **tradeable** edge in Polymarket’s **15‑minute BTC/ETH Up/Down** markets by exploiting potential short-term lag vs spot.

Product components:
1) Logger (market + orderbook + spot)
2) Regime monitor (alerts when market becomes tradable + watchdog)
3) Paper runner (conservative simulation; no rollover cheating; includes fees)
4) Walk‑forward tuner (OOS evaluation by slug windows)

Core principle: **don’t fool ourselves**.

## 2) Kill criteria / stop-loss for the project
To avoid infinite tinkering:

- If after **500+ slug windows** (per asset, aggregated) the **best OOS parameter set** has **net PnL ≤ 0** (after fees) **and** there is no clear path to add a single realism feature that plausibly flips sign (e.g., our model is already conservative), then we **shelve** this strategy direction.

Also “soft fail” earlier if:
- trade count remains effectively zero under reasonable thresholds (meaning the market is untradeable for our approach).

## 3) Goals / non-goals

### Goals
- Measure **best bid/ask** (not midpoint/last trade) and **best-level sizes** for both outcomes.
- Measure **spot** and sampling **skew/staleness**.
- Simulate conservatively:
  - taker entry at ask, taker exit at bid
  - respect depth at best level for size
  - bind entry/exit to the same `token_id` (no rollover cheating)
  - model taker fees (price-dependent curve)
- Evaluate OOS via walk-forward splits by **slug** (15m instruments).
- Detect silent failures (watchdog).

### Non-goals (MVP)
- Live trading / signing / wallet custody.
- Maker strategies (posting liquidity, rebates).
- Hedging on spot exchanges.
- Cross-market combinatorial arbitrage.
- VWAP-through-book / partial fills (planned next realism upgrade).

## 4) Users & operating model

### Primary user
- Bear (single operator) running logger/monitor/analysis jobs.

### Single-operator risk
We must assume the operator may be away during long runs.
- A stdout-only watchdog is not sufficient.
- Plan: add optional alert delivery (e.g., Telegram/Signal) for `health: stale`.

## 5) System components (current)

### A) Logger (`src/logger.py`)
- Discovers current 15m BTC/ETH event slugs (rollovers).
- Uses Gamma/CLOB endpoints to resolve token IDs and pull orderbooks.
- Records:
  - best bid/ask
  - best-level sizes
  - book timestamp (`book_ts`) + local fetch timestamp (`book_fetch_ts_ms`)
  - spot (Coinbase) + local fetch timestamp (`spot_fetch_ts_ms`)
- Writes JSONL with `rollover`, `snapshot`, `error` records.

#### Logger: data retention / storage
- Default output is per-day JSONL; long runs should be written to explicitly named files.
- Add/plan:
  - estimate daily disk footprint
  - rotation strategy (daily files; optionally gzip after day completes)
  - disk space monitoring / alert threshold

#### Logger: partial failure contract
- If spot fails, decide explicitly whether:
  - (A) skip snapshot, or
  - (B) emit snapshot with `spot=null` and an error field.

### B) Regime monitor (`projects/regime-monitor/monitor.py`)
- Emits alerts when inside spread remains tight for N consecutive snapshots.
- Includes:
  - top-of-book context (bid/ask/spread_bps)
  - filtering (assets/outcomes)
  - watchdog (`health: stale` / `health: ok`)

#### Monitor: alert delivery
- MVP is stdout + optional local log file.
- Plan: optional message delivery for stale + regime enter.

### C) Paper runner (`src/paper_runner.py`)
- Conservative taker model.
- Binds positions to `slug` + `token_id`.
- Gates: remaining time, depth, skew/book-age.
- Fee models:
  - `flat`, `curve`, `none`

#### Paper runner: latency modeling (planned)
- Add sensitivity runs with +2s / +5s delay (entry/exit decisions lagging).

#### Paper runner: concurrent position handling
- Current behavior is 1 position per asset.
- Document and enforce this invariant.

### D) Walk-forward tuner (`src/tuner.py`)
- Splits by `(asset, slug)` windows.
- Runs a small grid.
- Must treat zero-trade folds as a first-class signal.

## 6) Position sizing / capital constraints (paper)
Even in paper:
- Define a notional bankroll (e.g., **$500–$5,000**) and a max risk per 15m window.
- Keep size fixed for comparability, but report as a % of bankroll.

## 7) Success metrics
- Primary: OOS net PnL after fees.
- Secondary:
  - trade count per fold/day
  - drawdown distribution (paper)
  - stability of best params across folds
  - reject reasons distribution

## 8) Next execution plan (what we’ll build next)
1) Collect enough data for folds with non-zero trades.
2) Improve tuner reporting:
   - trades-per-fold
   - min-trades constraints
3) Add one realism upgrade:
   - deeper book logging + VWAP fills (see `notes/vwap-depth-plan.md`)
4) Add operator alerts for stale logger/monitor.

## 9) Security / disclosure for peer review
- Do not share API keys, credentials, or anything that enables trading.
- Share: event schemas, parameter grids, report summaries, and failure mode analysis.
