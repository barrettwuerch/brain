# Project Augur v2 (Kalshi) — High-Probability Bond Harvesting (scanner v0)

Status: **Phase 0** (scan/filter only, no orders).

## Run
```bash
node projects/kalshi/augur_v2/scanner.mjs --config projects/kalshi/augur_v2/config.paper.json
```

## Notes
- Uses live Kalshi REST for market discovery.
- No order placement in this phase.
- Logs JSONL to `projects/kalshi/augur_v2/logs/`.
