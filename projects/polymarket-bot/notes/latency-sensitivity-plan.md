# Latency sensitivity (paper runner)

We only have snapshot JSONL (spot + top-of-book). We can still do a *useful* latency sensitivity analysis without lookahead bias.

## Two types of latency

### 1) Decision lag (implemented now)
- Meaning: the strategy computes its signal using data as-of `t - decision_lag` but executes at time `t`.
- This models “slow reaction / stale signal”.

In code we implement this by:
- using `spot(t - decision_lag)` and `spot((t - decision_lag) - horizon)` for the return signal
- leaving book/execution at time `t` unchanged

CLI: `paper_runner.py --decision-lag <seconds>`

### 2) Execution lag (planned)
- Meaning: you decide at time `t` but the fill happens at `t + execution_lag` using the book at that later time.
- This needs an order queue / pending fills in the runner loop.

## Recommended next increment (after decision lag)
Add `--execution-lag-ms`, `--execution-jitter-ms`, and a pending-order queue, per the more detailed design in the sub-agent proposal.

The no-lookahead invariant: fills must use a snapshot with `ts <= t_exec`, and order prices must be fixed at decision time.

## Why this matters
If performance collapses under modest lag (e.g. 1–3 seconds), the edge is probably not robust enough for live trading.
