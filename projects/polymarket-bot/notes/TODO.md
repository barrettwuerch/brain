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
- [x] Add fee model (Polymarket taker curve; see notes/fees.md)
- [x] Walk-forward / out-of-sample parameter tuning (avoid overfit; see notes/walkforward-tuner.md)
- [ ] Improve tuner: treat zero-trade folds as signal + add min-trades constraint
- [ ] Add kill criteria to PRD + track progress toward OOS verdict thresholds
- [ ] Add data retention/rotation + disk usage notes for long logger runs
- [ ] Add single-operator alert delivery (send stale/regime alerts to a channel)
- [ ] Add latency sensitivity runs (+2s/+5s)
- [ ] (Optional realism) Add deeper-book logging + VWAP fill simulation (see notes/vwap-depth-plan.md)

## Phase 3 (Tiny live)
- [ ] Determine auth / keys / wallet flow
- [ ] Implement strict risk + kill-switch

## Phase 3 (Tiny live)
- [ ] Determine auth / keys / wallet flow
- [ ] Implement strict risk + kill-switch

