Title: Polymarket 15m Crypto Bot — Honest Paper Sim + Walk‑Forward Tuner (seeking peer review)

I’m building a laptop MVP to test whether there’s any *tradeable* edge in Polymarket’s 15‑minute BTC/ETH Up/Down markets. I’m looking for peer review specifically on: (1) whether the sim assumptions are conservative enough, (2) how you’d tighten execution realism, and (3) how you’d structure OOS evaluation to avoid overfitting.

## Why this exists
Most “arb / edge” discussions in prediction markets die once you model:
- bid/ask instead of midpoint/last trade
- orderbook depth / slippage
- staleness / timestamp skew
- rollover (instruments change every 15m)
- taker fees (these markets have a price-dependent curve)

So the core principle is: **don’t fool ourselves**.

## Current components (MVP)
1) **Logger** (polls ~2s)
- resolves current 15m BTC/ETH slugs
- pulls CLOB orderbooks per outcome token
- stores best bid/ask AND best-level sizes
- stores spot (Coinbase) + fetch timestamps

2) **Regime monitor**
- tails the JSONL and emits “tradable regime” alerts when inside spread stays tight for N consecutive snapshots
- includes a watchdog: emits `health: stale` if snapshots stop; `health: ok` once on recovery

3) **Paper runner** (conservative)
- entry: taker buy at best ask
- exit: taker sell at best bid
- binds positions to the same `token_id` across entry/exit (no rollover cheating)
- gates: remaining time buffer, depth, skew/book-age
- fees: supports **price-dependent taker fee curve** (interpolated from Polymarket docs)

4) **Walk-forward tuner / OOS evaluation**
- splits time-ordered by `(asset, slug)` windows
- runs a small param grid, evaluates on future windows
- outputs markdown + JSON reports

## What I’m NOT doing (yet)
- VWAP-through-book fills / partial fills (I have a written plan; not implemented yet)
- multi-market combinatorial arb (out of scope for now)
- live trading (only after OOS is positive + more realism)

## Peer review requests
1) Do you see any remaining “obvious self-deception” failure modes in the sim?
2) If you had only 1 realism upgrade to add next, would it be:
   - VWAP fills through top N levels
   - partial fill modeling
   - latency delay modeling (e.g. +2s, +5s)
   - something else?
3) Any suggestions for how to score folds? (net_sum vs net_mean, min-trades constraints, etc.)

If you want to look at a specific area, I can paste the event schemas and/or share the exact report outputs (no keys, no private info).
