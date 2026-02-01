# Triage Rubric (90-minute hardening)

Goal: maximize reliability impact per minute.

## Step 0: Establish the critical path (5–10 min)
- What is the agent’s main loop?
- What does “a successful cycle” mean?
- What external calls happen on the critical path?

## Step 1: Pick the top 3 failure points (10 min)
Rank by:
1) Likelihood (how often it fails)
2) Blast radius (how bad when it fails)
3) Recoverability (can it self-heal)

Common top picks:
- API calls without timeouts
- calls that 429 (need backoff/jitter)
- webhook sends without receipts
- file/DB writes without fsync/transaction

## Step 2: Apply primitives (50–60 min)
For each failure point:
- Add timeouts
- Add retry/backoff/jitter
- Add idempotency/deduping
- Bound concurrency
- Ensure errors are logged with correlation ids

## Step 3: Add watchdog (10–15 min)
- Choose heartbeat signal: file, DB row, metric
- Choose watchdog action: alert only OR safe restart
- Set defaults: stale_after_s=600, max_consecutive_failures=10

## Step 4: Verification (10 min)
Force failures:
- simulate 429/500
- simulate timeout/hang
Confirm:
- backoff works (no tight loop)
- watchdog fires on staleness
- logs remain bounded

## Output deliverable
- small diff / PR
- runbook
- definition of healthy
- rollback command
