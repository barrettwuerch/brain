# MVP ops/alerting plan (overnight logger/monitor runs)

Goal: keep logger/monitor runs unattended, avoid disk blow-ups, auto-restart on crashes, and notify Bear when unhealthy.

## Constraints / current state
- We currently have:
  - logger (`src/logger.py`) writing JSONL
  - regime monitor with a watchdog (stale/ok) but stdout-only
  - retention helper for JSONL: `scripts/retain_logs.py` (can gzip older logs)

## MVP additions to reach “don’t babysit it”

### A) Process supervision (macOS)
Use **launchd** (native) to:
- start a long-run logger on login/boot
- restart if it exits

### B) Heartbeat + watchdog
- Runner writes `projects/polymarket-bot/var/heartbeat.json` at least every 60 seconds.
- Separate watchdog job checks:
  - heartbeat freshness (e.g., stale if > 3 minutes)
  - disk usage (data dir + logs dir)

### C) Alert delivery
We need one alert channel that doesn’t require staring at stdout.
Options:
1) **OpenClaw notification** to your paired device (preferred)
2) **Message channel** (Telegram/Signal/etc.) if configured
3) macOS local notification + sound fallback

### D) Disk retention
- Daily output files (already supported by logger’s `--out`)
- Periodic gzip of older JSONL via:
  - `python3 scripts/retain_logs.py --data-dir data --gzip-older-days 1`

## Definition of done tests
- kill logger → it restarts
- stop snapshots (simulate hang) → watchdog alerts
- create big dummy logs → retention reduces disk growth

## Note
Implementing OpenClaw notifications from a standalone shell script may require a small helper that calls OpenClaw tooling. If that’s awkward, start with macOS notifications + a message channel using the OpenClaw agent itself.
