# OpenClaw End-State Vision: The Autonomous Mention-Market Maker (North Star)

> Authored by Bear. Captured from chat on 2026-02-03.
> This is the target-state spec; timeline is pushed forward.

## Intent
Build a Kalshi mention-market market-maker that can operate at the level of the modeled trader ("$1K → $390K"), but with robot-like discipline: never asleep, never fat-fingering, never forgetting to cancel orders.

## Key pillars (high-level)
- Event calendar integration + planning (runs 24/7; still uses event windows/modes)
- Mention market discovery via series/event/market hierarchy (no keyword hacks)
- FV estimation layered: base rate + recency + orderbook blend (no operator/manual overrides)
- Dynamic quoting engine: two-sided quoting via YES-bid + NO-bid with dynamic half-spread and continuous repricing
- Inventory management: per-market, per-event, global caps; skewing; flattening near session end
- Adverse selection defense: post-fill monitoring, trade tape analysis, spread dynamics, cross-market correlation, rolling toxicity score
- Risk controls: kill switch, daily loss cap, caps, error halts, session time limit, stale order sweeps, pre-trade validation
- Ops: dashboard, morning reports, alerting

## Phased roadmap (summary)
- Phase 0: Foundation (paper-only, REST polling, strict logs, kill switch)
- Phase 1: Smarter paper (mention discovery, stale cancel/replace, PnL + fees, toxicity metrics, morning report)
- Phase 2: Shadow mode (WS/trade tape; log what we would do)
- Phase 3: Live (autonomous within hard guardrails; no per-trade operator confirmations)
- Phase 4: More autonomous + scaling (still session-based; stronger monitoring/alerts)
- Phase 5: Fully autonomous (session-based; morning-report acknowledgement gate)

## Notes
This file is a condensed capture. The full, detailed text is in the chat transcript for 2026-02-03.
