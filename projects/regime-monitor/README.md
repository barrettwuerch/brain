# Regime Monitor (MVP)

A lightweight monitor that watches Polymarket 15m BTC/ETH Up/Down market *tradability regimes* and alerts when conditions are good.

## Goal
The bot project learned that most of the time spreads are untradeable; the valuable product is a monitor that tells you **when the market becomes tradable**.

## Inputs
- Logger JSONL produced by `projects/polymarket-bot/src/logger.py`

## Output (MVP)
- Console alerts (stdout) when spread remains tight for N consecutive snapshots.

## Run
1) Start the logger (in another terminal):
```bash
python3 projects/polymarket-bot/src/logger.py --poll 2
```

2) Run the monitor:
```bash
python3 projects/regime-monitor/monitor.py projects/polymarket-bot/data/2026-01-31.jsonl \
  --spread 0.03 --streak 5 \
  --min-remaining 60 \
  --other-spread-max 0.10 \
  --mode json \
  --log projects/regime-monitor/alerts.log
```

### Filtering
- Assets:
  - `--asset BTC --asset ETH` or `--assets BTC,ETH`
- Outcomes:
  - `--outcome Up --outcome Down` or `--outcomes Up,Down`

### Health / watchdog
- `--stale-after 15` (seconds)
- `--health-interval 60` (seconds)

### Text mode
If you want human-readable output instead of JSON:
```bash
python3 projects/regime-monitor/monitor.py projects/polymarket-bot/data/2026-01-31.jsonl --mode text
```

## Next steps
- Add optional notifications (SMS/Telegram/etc.) **only with Bear’s approval**.
- Add a tiny dashboard.
- Add filters (time-to-end, depth thresholds, staleness).
