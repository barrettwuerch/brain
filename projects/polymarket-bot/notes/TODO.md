# TODO

## Phase 1 (Logger)
- [x] Resolve current BTC/ETH 15m event slugs
- [x] Resolve token ids via gamma API
- [x] Pull orderbooks via CLOB API
- [x] Pull Coinbase spot price
- [x] Record fetch timestamps (spot_fetch_ts_ms, book_fetch_ts_ms)
- [x] Record best-level sizes (best_bid_size, best_ask_size)
- [ ] Add rate-limit + jitter controls
- [ ] Add rolling computation: time-to-end, detect rollover cleanly
- [ ] Add optional sqlite output

## Phase 2 (Paper trading)
- [x] Define initial entry conditions (spot return over horizon)
- [x] Simulate conservative fills (taker: buy at ask / sell at bid)
- [x] Bind positions to token_id/slug across entry/exit (no rollover cheating)
- [x] Add integrity gates: remaining_s buffer, skew/book-age, depth checks
- [ ] Compute PnL distribution + drawdown over larger samples
- [ ] Add fee model (Polymarket taker curve)
- [ ] Walk-forward / out-of-sample parameter tuning (avoid overfit)

## Phase 3 (Tiny live)
- [ ] Determine auth / keys / wallet flow
- [ ] Implement strict risk + kill-switch

## Phase 3 (Tiny live)
- [ ] Determine auth / keys / wallet flow
- [ ] Implement strict risk + kill-switch

