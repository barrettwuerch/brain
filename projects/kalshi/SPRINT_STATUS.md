# Kalshi Bot Sprint Status (Current Work + Next Step Plan)

Date: 2026-02-03
Owner: Kindling Usdi Yona
Reviewer: Bear

## 1) Objective
Start a focused sprint to move from the current foundation (v0 paper loop) to the **next step (v0.5)** aligned with:
- `NORTH_STAR.md`
- `RISK_STRUCTURE.md` (aggressive scaling w/ hard downside protection)
- constraints: no manual trades/confirmations; run 24/7; mention markets first.

## 2) Work completed so far (what exists right now)

### 2.1 Docs / specs (written)
All stored in `/Users/bear/.openclaw/workspace/projects/kalshi/`:
- `NORTH_STAR.md` — end-state vision (Bear)
- `RISK_STRUCTURE.md` — aggressive scaling risk parameters (Bear)
- `CONSTRAINTS.md` — no manual trade/confirmations, autonomous within guardrails
- `OPERATING_DECISIONS.md` — 24/7, mention markets only, stop via chat (plus safety backstop)
- `PRD.md` — initial PRD (paper → limited live)
- `PRD_FULL.md` — expanded PRD with current v0 logic (quoting, risk, logging)
- `PRD_V1_REVIEW.md` — captured note that Bear’s reviewed PRD v1 supersedes v0 spec
- `PLAN_UPDATE.md` — engineering implications of adopting aggressive risk structure
- `TODO.md` — implementation checklist derived from PRD v1 review

### 2.2 Credentials / connectivity (implemented)
- Kalshi auth works using signed requests with RSA private key.
- **Confirmed** `GET /trade-api/v2/portfolio/balance` succeeds against `https://api.elections.kalshi.com`.
- Smoke test script:
  - `connect.mjs`

### 2.3 Paper-trading runner (implemented, v0)
- Script: `bot.mjs`
- Config: `config.paper.json`
- Behavior today:
  - polls open markets
  - selects a small set of markets (spread-based heuristics; not reliably mention-only yet)
  - polls orderbooks
  - computes implied asks/mid/spread from Kalshi’s bids-only book
  - has a conservative paper broker and strict fill model
  - logs to JSONL
- Logs:
  - `logs/YYYY-MM-DD.jsonl`

### 2.4 What we learned from early runs
- Current v0 selection can land on non-mention markets because it only looks at the first markets page and uses weak heuristics.
- Under the conservative fill model, fills may be rare, meaning we need a better fill simulation model and/or better market selection.
- Process runs were sometimes SIGKILL’d due to iterative restarts; we should run the bot under a more stable long-running execution pattern.

## 3) Current gaps vs the “next step” (v0.5 requirements)
These are the blockers to meaningful paper results and harsh testing:

- **FV estimation beyond orderbook mid** (base rates + minimal news context)
- **Market rules parsing** (mention semantics, transcript source, timing)
- **Event timing extraction** (start/end windows for mode transitions)

1) **Mention market discovery (real)**
   - Need series/event/market hierarchy + pagination.
   - Must filter to mention markets (not “top spread sports”).

2) **Stale quote protection** (highest priority)
   - Add cancel/replace when quote drifts from target or becomes too close to implied ask.
   - Add max order age sweep.

3) **Event window modes**
   - Identify event start/end; define pre-event/live/post-event behavior.

4) **Toxicity / adverse selection metrics**
   - Track mid at fill and mid after 5/10/30s.
   - Maintain a rolling toxicity score per market.

5) **PnL + fee estimation (paper)**
   - Mark-to-mid and approximate fee drag to estimate whether spread capture is real.

6) **Morning report generator**
   - Summarize logs into an operator-readable report.

7) **Auto-scaling / percentage-based limits (paper first)**
   - Implement account-balance-based limits (10%/market, 25%/event, 5% daily loss, 15% drawdown, 85% profit lock).
   - Even in paper mode we can simulate these limits.

8) **WebSocket market data (next after v0.5)**
   - Needed for tape-driven fill simulation and better toxicity signals.

## 4) Proposed sprint scope: v0.5 (3–4 days)

### 4.1 Deliverables
- A v0.5 paper trader that:
  - selects **actual mention markets**
  - continuously quotes with cancel/replace and max-order-age
  - computes fill-then-move adverse selection metrics
  - enforces event exposure caps (paper)
  - outputs a daily “morning report” summary

### 4.2 Milestones / tasks (revised priority order)

**M0 (do first, ~2 hours) — Morning report on existing logs**
- Build `report.mjs` against existing v0 JSONL logs.
- Purpose: immediate learning loop (what is v0 actually doing?).

**M1 (day 1) — Mention market discovery + rules parsing + allowlist fallback**
- Implement paginated discovery over markets/events/series.
- Identify mention markets using a combination of:
  - series ticker patterns
  - event/title keyword matching (mention/say/said/etc)
  - contract title parsing
- Parse and cache per-market rules text to structured fields (keyword(s), root-word policy, transcript source, window).
- Provide operator-maintained allowlist (JSON) as a fallback when auto-detection fails.
- DoD gate: 10/10 spot-check are true mention markets.

**M2 (day 1–2) — Quote lifecycle + stale protection**
- Add `staleThresholdCents`, `repriceThresholdCents`, `maxOrderAgeSeconds`.
- Cancel/replace logic (paper broker first).
- Reprice trigger also fires when FV changes (not just mid/book drift).

**M3 (day 2) — Toxicity metrics + event window modes**
- Implement fill-then-move logging at +5/+10/+30 seconds.
- Add pre-event / event-live / post-event mode transitions based on event timing.

**M4 (day 2–3) — Risk model integration (aggressive, percent-based)**
- Encode limits from `RISK_STRUCTURE.md`.
- Auto-recalculate limits at session open.
- Add per-event exposure calculation.

**M5 (day 3) — Static FV model (base rates + news context)**
- Add a minimal FV layer beyond orderbook mid:
  - base rates JSON (keyword × event type)
  - simple RSS/news intensity adjustment
  - FV = base_rate + adjustment, blended with mid by proximity/confidence

## 5) Definitions of done (v0.5)
- Bot runs continuously for >= 12 hours without crashing.
- Selection returns mention markets (spot-check 10/10 markets are mention markets).
- Orders are placed and repriced (paper) and fills occur at a non-trivial rate.
- Report is generated and readable, with key metrics and anomalies.
- Kill switch stops within 5 seconds.

## 6) Files (for review)
- Code:
  - `bot.mjs`
  - `connect.mjs`
- Config:
  - `config.paper.json`
- Docs:
  - `NORTH_STAR.md`, `RISK_STRUCTURE.md`, `CONSTRAINTS.md`, `OPERATING_DECISIONS.md`
  - `PRD.md`, `PRD_FULL.md`, `PRD_V1_REVIEW.md`, `PLAN_UPDATE.md`, `TODO.md`
- Logs:
  - `logs/*.jsonl`

## 7) Review questions for Bear
1) Confirm v0.5 goal: “meaningful paper results + harsh testing readiness,” not live trading.
2) Confirm we should hard-filter to mention markets even if it reduces the count available (quality > quantity early).
3) Confirm whether to use Kalshi **demo** environment for harsh execution testing once WS is added.
