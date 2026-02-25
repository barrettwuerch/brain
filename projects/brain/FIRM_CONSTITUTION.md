# THE FIRM — Constitution

## Mission
Build a self-improving trading firm that compounds capital across two horizons: active prediction market trading (Front Office, 30-day) and long-term investment holdings (Back Office, multi-year). The Back Office does not get built until the Front Office proves itself.

## Capital Preservation Rules (inviolable — no bot can override)
- Maximum drawdown from equity peak: 15%. All trading halts if breached.
- No single strategy > 30% of deployed capital.
- No single market category > 40% of deployed capital.
- Minimum cash reserve: 20% of capital, never deployed.
- No live trading without 30+ forward test trades matching backtest within 30%.
- Crypto: BTC drop ≥10% in 60 minutes → halt all crypto new entries immediately.

## Compounding Rules
- Profits above initial capital: 70% reinvested, 30% reserved.
- Strategy capital scales UP only after 30 forward test trades with positive P&L.
- Strategy capital scales DOWN automatically when IS < 0.05 for 2 evaluations.

## Front Office Gates (must all be true before Back Office begins)
- 90 consecutive profitable days, net of all costs, drawdown < 15%
- At least one circuit breaker activated and recovered correctly
- Intelligence Bot has 6+ months of consolidation history
- Portfolio Manager Bot is operational

## The Override Rule
No bot can override a capital preservation rule. Human override requires Managing Partner decision logged with reason.

## Wing Namespacing
All bot_ids, task types, and semantic facts carry wing prefix:
- Front Office: 'front.' prefix (e.g., 'front.research-bot-1')
- Back Office: 'back.' prefix (when built)
- Shared infra: no prefix

## Bot Inventory (authoritative strings)
Table below uses *exact* `agent_role` + `task_type` strings as they appear in code.

| bot_id | agent_role | default bot_state | IS score source | task_types handled |
|---|---|---|---|---|
| `research-bot-1` | `research` | `exploiting` | `public.intelligence_scores` (metric=`intelligence_score`, latest) | `monitor_approved_findings`, `generate_next_generation_hypothesis`, `validate_edge_mechanism`, `funding_rate_scan`, `volatility_regime_detect`, `correlation_scan` |
| `crypto-research-bot-1` | `research` | `exploiting` | `public.intelligence_scores` (metric=`intelligence_score`, latest) | `monitor_approved_findings`, `crypto_trend_scan`, `crypto_volume_profile`, `funding_rate_scan`, `volatility_regime_detect`, `correlation_scan` |
| `strategy-bot-1` | `strategy` | `exploiting` | `public.intelligence_scores` (metric=`intelligence_score`, latest) | `formalize_strategy`, `challenge_strategy`, `run_backtest`, `detect_overfitting`, `walk_forward_analysis` |
| `crypto-strategy-bot-1` | `strategy` | `exploiting` | `public.intelligence_scores` (metric=`intelligence_score`, latest) | `formalize_crypto_strategy`, `challenge_crypto_strategy`, `run_crypto_backtest`, `detect_overfitting`, `walk_forward_analysis` |
| `risk-bot-1` | `risk` | `exploiting` | `public.intelligence_scores` (metric=`intelligence_score`, latest) | `monitor_positions`, `check_drawdown_limit`, `detect_concentration`, `evaluate_circuit_breakers`, `size_position`, `publish_regime_state` |
| `execution-bot-1` | `execution` | `exploiting` | `public.intelligence_scores` (metric=`intelligence_score`, latest) | `evaluate_market_conditions`, `place_limit_order`, `manage_open_position`, `handle_partial_fill` |
| `crypto-execution-bot-1` | `execution` | `exploiting` | `public.intelligence_scores` (metric=`intelligence_score`, latest) | `evaluate_crypto_market_conditions`, `place_crypto_limit_order`, `manage_crypto_position`, `handle_partial_fill` |
| `orchestrator-1` | `orchestrator` | `exploiting` | `public.intelligence_scores` (metric=`intelligence_score`, latest) | `route_research_findings`, `register_watch_conditions`, `review_bot_states`, `generate_priority_map`, `update_stale_watch_conditions`, `review_dead_ends` |
| `cos-bot-1` | `chief_of_staff` | `exploiting` | `public.intelligence_scores` (metric=`intelligence_score`, latest) | `assess_strategic_priorities`, `generate_daily_brief`, `generate_weekly_memo`, `detect_systematic_blind_spots`, `generate_decision_packet`, `review_regime_strategy_alignment`, `evaluate_bottlenecks` |
| `intelligence-bot-1` | `intelligence` | `exploiting` | `public.intelligence_scores` (metric=`intelligence_score`, latest) | `consolidate_memories`, `attribute_performance`, `generate_daily_report`, `generate_weekly_report`, `prune_expired_memories`, `propose_skill_update`, `aggregate_challenge_calibration` |

## Market Expansion Rules
- New market adapter requires before paper trading begins: tasks.ts, compute.ts, data_feed.ts, SKILL addendum, market-specific Risk Bot circuit breakers
- Build order: crypto → equities → options
- No new market paper trading until prior market has 30+ verified paper trades
- No two new adapters built simultaneously
- Brain loop, memory layer, state machine: never forked per market
- Alpaca is the execution layer for crypto + equities + options

---

## Pre-Live Verification Gates
No market goes live with real capital until all five gates below are verified and documented with console output.
These tests do not require live API keys — they require deliberate test fixtures.

### Gate 0 — Market Data Freshness (Scanner)
Verify scanner cycle blocks **before any strategy evaluation attempt** when market data is stale.

Required console evidence must include a line of the form:
- `Gate 0 blocked: Alpaca bar.t=... is X min old (threshold: 5 min)`
- `Gate 0 blocked: Kalshi market.updated_time=... is X min old (threshold: 15 min)`

And must include the comment in code:
- "reads market data timestamp, NOT task creation time."

Console output saved to tests/pre_live/gate0_freshness.txt

### Gate 1 — End-to-End Chain Test
A synthetic ResearchFinding with rqs_score=0.70 must flow automatically through the full pipeline without manual intervention:
Research (status=under_investigation, rqs_score=0.70) → Orchestrator routes to Strategy → Strategy backtests and approves → Orchestrator registers WatchCondition → Scanner fires on the condition → Execution task created and processed → Position opened in positions table

All steps verified with console output saved to tests/pre_live/gate1_chain_test.txt

### Gate 2 — Circuit Breaker Test
1. Manually trigger max_drawdown circuit breaker
2. Verify all affected bots transition to PAUSED (check-states output confirms)
3. Verify manual reset to EXPLOITING works
4. Verify no new positions were opened while PAUSED

Console output saved to tests/pre_live/gate2_circuit_breaker.txt

### Gate 3 — IS Scoring with Varied Outcomes
Run 20+ episodes with deliberately mixed outcomes (mix of outcome=correct and outcome=incorrect).
Verify IS score reflects the mix and is not uniformly 0.475 (test mode artifact).
Verify calibration_score is non-zero with varied data.

Console output saved to tests/pre_live/gate3_is_scoring.txt

### Gate 4 — Kelly Scaling Verification
Verify position size reduces correctly at each tier:
0–5% drawdown: size = base × 1.00
5–10% drawdown: size = base × 0.60
10–15% drawdown: size = base × 0.30

Test by calling getKellyMultiplier() directly with values in each tier range.

Console output saved to tests/pre_live/gate4_kelly_scaling.txt
