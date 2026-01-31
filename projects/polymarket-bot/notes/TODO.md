# TODO

## Phase 1 (Logger)
- [x] Resolve current BTC/ETH 15m event slugs
- [x] Resolve token ids via gamma API
- [x] Pull orderbooks via CLOB API
- [x] Pull Coinbase spot price
- [ ] Add rate-limit + jitter controls
- [ ] Add rolling computation: time-to-end, detect rollover cleanly
- [ ] Add optional sqlite output

## Phase 2 (Paper trading)
- [ ] Define candidate entry conditions
- [ ] Simulate conservative fills
- [ ] Compute PnL distribution + drawdown

## Phase 3 (Tiny live)
- [ ] Determine auth / keys / wallet flow
- [ ] Implement strict risk + kill-switch

