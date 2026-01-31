# Polymarket Bot (Laptop MVP)

## Goal
Test whether there is *tradeable* edge in very short-term Polymarket crypto “Up/Down – 15 minute” markets by exploiting possible price/odds lag vs spot.

This MVP is designed to **learn fast and safely**:
- Start with **paper trading** + logging.
- Then graduate to **tiny-size live** with strict risk limits.
- No martingale / no doubling.

## Key reality check (microstructure)
- The displayed probability/price can be the **midpoint** of bid/ask, or **last trade** when spread is wide.
- If we don’t measure **best bid/ask** + depth + timestamp skew, we can fool ourselves.

## Project hygiene (so chat context isn’t required)
- Specs/decisions live in `projects/polymarket-bot/notes/`.
- Important assumptions are enforced in code (runner gates) and reported (reject reasons).
- If you change a rule, update:
  1) `notes/DECISIONS.md`
  2) the code
  3) README/TODO as needed

## MVP Phases
### Phase 0 — Research & constraints (1–2 hrs)
- Confirm fee model for the specific markets we trade.
- Identify official/unofficial endpoints for:
  - market list (15m BTC/ETH/etc)
  - orderbook (best bid/ask)
  - trades (last N)
  - placing/canceling orders

Deliverable: `notes/endpoints.md` + `notes/fees.md`

### Phase 1 — Data logger (paper) (4–8 hrs)
Build a service that:
- Polls every 1–2s (start slower if needed) for each target market window:
  - timestamp
  - time remaining in the 15m window
  - best bid/ask YES + NO
  - last trade price + size
  - displayed probability (optional)
  - spot BTC/ETH price + 1s return (from a chosen exchange API)
- Writes to a local sqlite/db or newline json logs.

Deliverable: `data/*.jsonl` + `scripts/summary.py` to compute spreads, staleness, and latency.

### Phase 2 — Paper strategy runner (4–8 hrs)
Implement simulated execution:
- Only enter when:
  - spread <= X (e.g. 2–4c)
  - book depth >= Y (if available)
  - spot move threshold met (e.g. spot return over 20–40s exceeds T)
- Simulate limit fills conservatively:
  - fill at ask for buys / bid for sells
  - include slippage buffer
- Exit rules:
  - time stop (e.g. exit after N seconds)
  - profit target (small)
  - hard stop loss

Deliverable: `reports/backtest-YYYY-MM-DD.md`

### Phase 3 — Tiny live (only if Phase 2 is positive)
Risk rules (non-negotiable):
- Max loss per 15m window: $A
- Max loss per day: $B
- Max position size: $C
- Kill switch:
  - if 3 consecutive stop-outs
  - if spreads widen beyond threshold
  - if API errors exceed N

Deliverable: `reports/live-YYYY-MM-DD.md`

## Strategy candidates to test (not promises)
1) **Lag-catcher**: after rapid spot move, place limit on “right” side slightly inside book.
2) **Overcrowding fade**: when odds swing extreme early + book thins, test mean reversion (higher risk).

## What we’ll measure (success metrics)
- Net PnL after fees/slippage
- Fill rate, partial fills
- Average spread at entry
- Worst drawdown
- Sensitivity to 2–5s extra latency (simulate being slower)

## Next questions for Bear
1) Which markets first? (BTC only to start?)
2) Preferred spot source: Coinbase, Binance, Kraken?
3) Risk caps (A/B/C) for eventual tiny-live test?
