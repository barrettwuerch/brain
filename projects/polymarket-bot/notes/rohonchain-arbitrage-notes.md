# Notes — Rohonchain thread on Polymarket arbitrage (context + takeaways)

Source: pasted thread text from Bear (originally from X).

## What it’s claiming (high-level)
- Significant profits have been extracted from Polymarket via **arbitrage**, including so‑called “guaranteed” opportunities.
- The core claim is that real edge comes from:
  - **constraint-based reasoning** across logically-linked markets (not just single YES/NO pairs)
  - **optimization** (integer programming, Frank–Wolfe, Bregman projection)
  - **execution realism** (non-atomic legs, order book depth, VWAP/slippage, latency)

## Key concepts worth keeping (even if we don’t build the full system)

### 1) Single-market vs multi-market arbitrage
- Simple check “YES + NO != 1” is only the easiest case.
- Real opportunities can arise from **logical dependencies** across markets (A implies B, mutual exclusivity, etc.).

### 2) The execution risk is the real boss
- In a CLOB, trades are not atomic. One leg can fill and another can move.
- Therefore, we should treat “guaranteed” in backtests as **only as good as fill assumptions** + depth.

### 3) Depth + VWAP matter more than top-of-book
- A strategy’s true fill price is closer to a **VWAP through the book**, not best bid/ask.
- Practical cap: position sizing should be limited by the **minimum available liquidity** across required legs.

### 4) Latency dominates small edges
- Many of these edges exist at “block timescale” (~seconds).
- Polling strategies can still be useful (like ours), but we should aim to:
  - log/measure staleness and skew (already done)
  - keep minimum edge thresholds high enough to survive execution

## How this maps to our current project (15m crypto Up/Down)
Our current focus is intentionally narrower:
- single market window at a time (BTC/ETH 15m)
- use best bid/ask, depth gates, skew/age gates
- conservative taker fills

Even within this narrower scope, the thread reinforces our direction:
- **don’t use midpoint/last trade**
- **bind entry/exit to token_id**
- add **fee modeling**
- add **walk-forward / OOS tuning**
- add more execution realism (depth + VWAP)

## Concrete additions we can implement next (incremental, MVP-friendly)
1) **VWAP-through-book simulation** (paper_runner)
   - Instead of assuming fill at best bid/ask, compute VWAP for `size` using multiple levels from the book.
   - Requires logger to capture multiple price levels (not just best).

2) **Multi-leg execution risk model** (future)
   - For any strategy requiring multiple legs (YES+NO, or cross-market), simulate sequential fills and price impact.

3) **Minimum edge threshold after fees + slippage**
   - Track “expected edge” at entry and require it to exceed a configured minimum.

4) **Dependency/arbitrage across markets** (future research)
   - Only after we have robust fee + execution modeling.
   - Requires market taxonomy, constraint definitions, and a solver.

## Action items (tie into TODO)
- Implement fee model described in `notes/fees.md`.
- Implement walk-forward tuner described in `notes/walkforward-tuner.md`.
- If we keep going: upgrade logger to capture deeper book to enable VWAP fills.
