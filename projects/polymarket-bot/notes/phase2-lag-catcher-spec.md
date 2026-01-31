# Phase 2 (Paper) Strategy Spec — Lag-Catcher (BTC+ETH 15m)

## Thesis
Sometimes Polymarket CLOB reprices more slowly than spot moves (Coinbase). If spreads are tight and depth exists, a fast move may create a short window where buying the “correct” side at a favorable price has positive EV.

## Non-negotiable constraints
- Paper only.
- No martingale, no doubling.
- Only trade when market is *tradable* (tight spread + sufficient depth).

## Definitions
- **Inside spread**: best_ask - best_bid (per outcome token)
- **Mid**: (best_bid + best_ask) / 2
- **WindowStart**: start of the 15m interval (per slug)

## Market selection
- BTC and ETH 15m Up/Down markets.
- Must have enableOrderBook=true and not closed.

## Tradable regime gates (must all pass)
For the side we intend to buy (e.g. Up token when we think Up):
- Spread for that token <= $0.03 (tune)
- Ask depth at best_ask >= $D_min
- Bid depth at best_bid >= $D_min
- Book snapshot recency: (now_ms - book_ts_ms) <= 3000ms
- Coinbase spot available.

## Signal (spot move trigger)
Compute spot return over short horizon H:
- r = (spot_now - spot_Hs_ago) / spot_Hs_ago

Trigger candidates (to test):
- H = 20s, 40s
- Threshold |r| >= 0.0008 (8 bps) BTC, 0.0012 (12 bps) ETH (tune)

Direction:
- If r > 0 → prefer Up
- If r < 0 → prefer Down

## Entry (paper fill model)
We simulate placing a limit buy:
- price = min(best_ask, mid + entry_slip)
Conservative fill assumption options:
1) **Taker fill**: always assume fill at best_ask (worst realistic)
2) **Maker-ish**: fill at min(best_ask, best_bid + 0.01) only if subsequent book shows price traded through

Start with (1).

## Exit rules
Primary exits (first hit wins):
- Time stop: exit after N seconds (e.g. 20s, 40s, 80s) — sweep these.
- Stop loss: if mid moves against by >= $0.02 (or if spread blows out beyond $0.10)
- Take profit: if mid improves by >= $0.01–$0.02

## Safety / no-trade rules
- Skip if either token (Up/Down) shows spread > $0.10 (market unhealthy)
- Skip first X seconds after rollover (e.g. first 10s) until book stabilizes
- Skip if Coinbase spot is stale (same value for >N polls)

## Metrics to report
- Trades taken, win rate, avg pnl, median pnl
- Worst drawdown
- Spread at entry distribution
- Sensitivity: rerun assuming +2s and +5s delay

## Next implementation steps
- Enhance logger to keep a rolling spot buffer (last 2–3 minutes) for return computations.
- Build a `paper_runner.py` that replays JSONL and outputs a report.
