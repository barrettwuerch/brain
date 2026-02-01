# Runbook — <AGENT NAME>

## How to start
```bash
# command here
```

## How to stop
```bash
# command here
```

## Where logs are
- stdout/stderr: ...
- log files: ...

## Definition of healthy
- last success timestamp updates at least every: <N> seconds
- error rate: <threshold>
- disk usage: <threshold>

## Common failure modes
### 429 / rate limits
- Symptoms:
- Expected behavior:
- What to do:

### Timeouts / hangs
- Symptoms:
- Watchdog behavior:
- What to do:

## Quick health check (5 minutes)
1) Check last success timestamp
2) Check recent errors
3) Check disk usage/log growth
4) If stale: restart using the supervisor instructions
