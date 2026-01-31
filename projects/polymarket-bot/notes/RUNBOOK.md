# RUNBOOK — Polymarket Bot (Laptop MVP)

This runbook exists so you can operate the logger/monitor/runner without relying on chat context.

## Repo map (key files)
- Logger: `projects/polymarket-bot/src/logger.py`
- Paper runner (replay + report): `projects/polymarket-bot/src/paper_runner.py`
- Regime monitor (tail -f + alerts): `projects/regime-monitor/monitor.py`
- Decisions/spec: `projects/polymarket-bot/notes/DECISIONS.md`
- Strategy spec: `projects/polymarket-bot/notes/phase2-lag-catcher-spec.md`

## Quickstart

### 1) Run the logger
Writes JSONL snapshots to `projects/polymarket-bot/data/YYYY-MM-DD.jsonl` by default.

```bash
python3 projects/polymarket-bot/src/logger.py --poll 2
```

Optional (explicit output file):
```bash
python3 projects/polymarket-bot/src/logger.py --poll 2 --out projects/polymarket-bot/data/live.jsonl
```

### 2) Run the regime monitor (tradability alerts)
Default output is JSON lines (good for piping / grepping).

```bash
python3 projects/regime-monitor/monitor.py projects/polymarket-bot/data/live.jsonl \
  --spread 0.03 --streak 5 \
  --min-remaining 60 \
  --other-spread-max 0.10 \
  --stale-after 15 --health-interval 60 \
  --log projects/regime-monitor/alerts.log
```

Filtering example (BTC Up only):
```bash
python3 projects/regime-monitor/monitor.py projects/polymarket-bot/data/live.jsonl \
  --asset BTC --outcome Up
```

Text mode:
```bash
python3 projects/regime-monitor/monitor.py projects/polymarket-bot/data/live.jsonl --mode text
```

### 3) Run the paper runner (replay a JSONL file)
This simulates conservative fills (taker-by-default) and enforces integrity gates.

```bash
python3 projects/polymarket-bot/src/paper_runner.py projects/polymarket-bot/data/live.jsonl \
  --hold 40 --buffer 10 \
  --size 10 --min-depth 10 \
  --max-skew-ms 1500 --max-book-age-ms 5000
```

Notes:
- For small samples, you may see `no_spot_history` rejects. That just means the file doesn’t yet contain enough history to compute the horizon return.

## Health checks / failure modes

### A) Monitor prints HEALTH STALE
Meaning: no new `type:snapshot` lines have been observed for > `--stale-after` seconds.

What to check:
1) Is the logger still running?
2) Is the monitor pointed at the correct file path?
3) Did the logger stop writing due to endpoint failures (see JSONL for `type:error` records)?

Recovery behavior:
- When the next snapshot arrives, monitor prints/emits `health: ok` exactly once.

### B) Logger produces repeated `type:error` about slug resolution
Meaning: the Polymarket `/crypto/15M` page format can change; slug discovery can fail.

What to check:
- Look at the error payload in JSONL (logger writes details including HTML head snippet).
- You may need to update the slug discovery parsing logic.

### C) Orderbook timeouts
Meaning: `clob.polymarket.com` requests timed out.

What to do:
- Lower poll rate (e.g. `--poll 3` or `--poll 5`).
- Add jitter/backoff (TODO).

### D) Paper runner shows `rollover_cross` or `exit_missing_book`
Meaning: you entered a position and could not exit on the same `token_id` (rollover / missing data).

Interpretation:
- This is treated conservatively; it is a red flag for “real-world tradability.”

## Data contract (must remain stable)
- Logger snapshots should include:
  - `spot_fetch_ts_ms` and per-book `book_fetch_ts_ms`
  - `best_bid_size` / `best_ask_size`
  - `book_ts` when present
If those are missing, runner/monitor may disable skew/age logic or reject trades.

## Next planned work
- Fee modeling (taker curve, token fee rates).
- Walk-forward / out-of-sample tuning.
- Only then: tiny-live with strict risk caps (Bear approval required).
