# BeanBot (Kalshi NBA) — Handoff / Project Capture

This doc is meant to preserve **everything important we learned + the exact commands/files** so Bear can start a new project without losing context.

## What BeanBot is
BeanBot is an NBA strategy/backtest + (paper) execution scaffold for **Kalshi NBA game markets** (`KXNBAGAME-...`).

Primary artifact: the backtest runner `scripts/backtest_50k.mjs`, which simulates trading across a dataset of `qualifying_event` rows.

## Repo location
- Project root: `projects/kalshi/nba/`

## Key outputs (what to trust / copy)
### Full backtest trade log
- Output file (overwritten each run):
  - `data_full/backtest_trades.jsonl`

### Monthly summary (for spreadsheet)
- Script:
  - `scripts/monthly_summary.mjs`
- Run:
  - `node scripts/monthly_summary.mjs`
- Output: JSON lines with `{month,wins,losses,avg_win,avg_loss,total_pnl}`

### Debug script (to sanity-check file content)
- Script:
  - `scripts/monthly_debug.mjs`
- Run:
  - `node scripts/monthly_debug.mjs`

## Canonical commands
Run from: `projects/kalshi/nba/`

### 1) Run the full backtest (tiered sizing)
```bash
node scripts/backtest_50k.mjs --sizing tiered
```

### 2) Confirm trade count (expected ~156 when cache works)
```bash
wc -l data_full/backtest_trades.jsonl
```

### 3) Monthly summary to paste into spreadsheet
```bash
node scripts/monthly_summary.mjs
```

## Data inputs (what the backtest reads)
### Dataset (qualifying events)
- The backtest reads ONE dataset file:
  - either `--file <path>`
  - or the **latest** `data_full/dataset_*.jsonl` (by mtime)

In current workspace, latest observed dataset file:
- `data_full/dataset_2026-02-22_1771800142334.jsonl`

`qualifying_event` rows are selected via:
```js
rows.filter(r => r.type === 'qualifying_event')
```

### Prod PnL cache
- Cache file:
  - `data_full/prod_pnl_cache.json`

This cache is critical to avoid calling Kalshi candles for every event and to make historical backtests deterministic.

## Important incident: “missing 150 trades” root cause + fix
### Symptom
Backtest took only ~10 trades and reported:
- `Trades skipped (risk gates): 150`

But the risk gates were not the real reason.

### Root cause
`prod_pnl_cache.json` contained **old-style numeric entries** (e.g. `-21`) representing pnl cents per contract, while the backtest code expected cached values to be **objects** like `{ pnlC: -21, ... }`.

So, on cache hit:
- `prod` became a number
- `prod?.pnlC` was `undefined`
- the code treated that as missing PnL and skipped the trade

### Fix (implemented)
In `scripts/backtest_50k.mjs` inside `prodPnlForEvent`, cache hits are normalized:
- if cached is a number → return `{ pnlC: cached }`

After the fix, the same run produced:
- **156 trades taken**
- monthly breakdown across **8 months**

## Skip reason instrumentation (implemented)
`backtest_50k.mjs` now prints granular skip reasons at end:
```json
{
  "missingPnl": 1,
  "dailyCap": 3,
  "weeklyPause": 0,
  "hardStop": 0,
  "contractsSmall": 0
}
```

This is useful any time the trade count looks suspicious.

## Where the rest of the system lives
### Core engine / bot scaffolding
- `src/nba_bot.mjs`
- `src/engine.mjs`
- `src/paper_broker.mjs`
- `src/risk_state.mjs`
- `src/kalshi_client.mjs`
- ESPN data:
  - `src/espn_scoreboard.mjs`
  - `src/espn_summary.mjs`

### Exit rules / pre-live checklist
- `docs/EXIT_RULES.md`
- `docs/REVIEW_BEFORE_LIVE.md`

### Logs/state
- `logs/` contains daily summaries and state snapshots, including:
  - `logs/risk_state.json`
  - `logs/state.json`

## What to copy into a new project (minimum viable capture)
If you start a new repo/project and want to preserve the “working core”, copy:
- `scripts/backtest_50k.mjs`
- `scripts/monthly_summary.mjs`
- `scripts/monthly_debug.mjs`
- `src/` (at least scorer + espn + kalshi client + exit simulation parts)
- `docs/EXIT_RULES.md`, `docs/REVIEW_BEFORE_LIVE.md`
- `config.paper.json` (but not secrets; keep paths as placeholders)

## Notes / TODOs
- `--start` is currently passed in some commands, but `backtest_50k.mjs` uses `startingCapital = 50000` hardcoded (flag currently a no-op).
- If trade count is unexpectedly low, check:
  1) `wc -l data_full/backtest_trades.jsonl`
  2) `node scripts/monthly_debug.mjs`
  3) printed `Skip reasons` at end of backtest
  4) whether `data_full/prod_pnl_cache.json` matches the expected cache value format
