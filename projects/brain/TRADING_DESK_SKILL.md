# TRADING DESK — Skill File

Read this before touching anything related to the trading desk layer.

## What This Project Is

You are building an autonomous trading desk — a multi-agent system where specialist bots execute trades, validate strategies, manage risk, and learn from every decision.

The brain (`projects/brain/`) is the foundation every bot runs on. The trading desk is the brain at scale.

This file governs everything above the brain layer. For brain-level rules, read `projects/brain/SKILL.md` first.

## The Non-Negotiables

- The brain is never modified to be task-specific. It stays generic. Task-specific logic goes in SKILL.md files per bot role.
- Risk Bot runs independently of every other desk. It is never blocked by another bot's work.
- No live capital is deployed until a strategy has passed backtest AND forward test (paper trading).
- Every bot writes episodes to Supabase with `agent_role`, `desk`, and `bot_id` populated. No exceptions.
- The Orchestrator holds business context. Specialist bots hold domain knowledge. Never mix these.

## The Org Chart

YOU (Managing Partner)
↓
ORCHESTRATOR (Head of Trading)
- Holds: market context, desk performance, capital allocation, risk limits
- Does: routes tasks, monitors agents, manages capital, delivers reports

│
├── RESEARCH DESK → find edges before capital is deployed
├── STRATEGY DESK → validate and deploy strategies
├── EXECUTION DESK → put trades on cleanly
├── RISK DESK → protect capital, always running
└── INTELLIGENCE DESK → brain layer, cuts across all desks

Multiple bots can run the same job simultaneously (× N). They all write to the same shared Supabase memory layer. What one learns, all inherit via nightly consolidation.

## The Five Desks

### RESEARCH DESK

**Purpose:** Find edges before capital is deployed. Never touches money.

**Jobs and their bots:**
- `market_scanning` — Scanner Bot × N. Monitors for anomalies, volume spikes, sentiment shifts, news catalysts.
- `pattern_analysis` — Pattern Bot × N. Identifies statistical regularities. Distinguishes real edges from noise.
- `data_gathering` — Data Bot × N. Pulls, cleans, validates market data. Flags quality issues upstream.
- `competitor_intelligence` — Intel Bot × N. Monitors crowd positioning, funding rates, large-player flows.

**Task types:**
- `scan_price_anomaly`, `scan_volume_spike`, `scan_sentiment_shift`, `detect_trend_pattern`, `detect_mean_reversion`, `test_pattern_significance`, `fetch_price_data`, `validate_data_quality`, `scan_open_interest`, `detect_crowded_trade`

**SKILL.md priorities:**
- Statistical significance testing before reporting any pattern
- Distinguishing correlation from causation — never conflate
- Market microstructure — how prices actually move and why
- Regime identification — bull, bear, high-vol, low-vol conditions
- Data quality validation — garbage in, garbage out

### STRATEGY DESK

**Purpose:** Turn research findings into deployable, validated strategies.

**Jobs and their bots:**
- `strategy_development` — Strategy Bot × 2. Formalizes rules: entry, exit, position sizing, invalidation.
- `backtesting` — Backtest Bot × 4. Validates historically. Detects overfitting. Mandatory before any deployment.
- `optimization` — Optimize Bot × 2. Tunes parameters with walk-forward analysis. Never optimizes on full dataset.
- `forward_testing` — FwdTest Bot × 2. Paper trades in live conditions before real capital.

**Task types:**
- `formalize_entry_rules`, `formalize_exit_rules`, `run_backtest`, `stress_test_regimes`, `detect_overfitting`, `compute_statistics`, `walk_forward_analysis`, `tune_parameters`, `paper_trade`, `approve_for_live`

**SKILL.md priorities:**
- Overfitting detection is mandatory — see Backtesting Rules below
- Walk-forward analysis for any strategy with more than 3 parameters
- Regime-conditional performance — must test bull, bear, high-vol separately
- Position sizing theory — Kelly criterion with fractional application
- Strategy invalidation criteria — define when to stop trading a strategy

### EXECUTION DESK

**Purpose:** Put trades on cleanly. Knows the how, not the why.

**Jobs and their bots:**
- `order_entry` — Order Bot × 3. Places trades with correct order types. Minimizes slippage. Handles rejections.
- `trade_management` — Position Bot × 3. Manages open positions. Executes exit rules without deviation.
- `position_sizing` — Sizing Bot × 2. Computes capital per trade given current risk and portfolio exposure.

**Task types:**
- `place_market_order`, `place_limit_order`, `handle_partial_fill`, `confirm_execution`, `adjust_stop`, `take_partial_profit`, `execute_exit`, `compute_kelly_size`, `check_portfolio_exposure`, `apply_risk_limit`

**SKILL.md priorities:**
- Order types and when to use each — never default to market orders
- Slippage estimation — always model realistic fill prices, minimum 0.05% per trade
- Liquidity timing — when spreads are tightest
- Partial fill handling — never assume full execution
- Market impact — how your own orders move the market at scale

### RISK DESK

**Purpose:** The desk's immune system. Runs independently of everything else. Never blocked.

**Jobs and their bots:**
- `position_monitoring` — Monitor Bot × 3. Real-time tracking of all open positions and current exposure.
- `drawdown_control` — Drawdown Bot × 1. Enforces max drawdown rules. Scales back sizing automatically.
- `correlation_monitoring` — Correlation Bot × 2. Detects factor concentration. Prevents illusion of diversification.
- `circuit_breakers` — Breaker Bot × 1. Autonomous shutdown. No human required to pull the plug.

**Task types:**
- `track_open_positions`, `compute_unrealized_pnl`, `compute_current_exposure`, `flag_position_breach`, `check_drawdown_limit`, `scale_back_sizing`, `compute_position_correlations`, `detect_factor_concentration`, `check_daily_loss_limit`, `execute_shutdown`

**SKILL.md priorities:**
- Drawdown compounding math — losses are asymmetric (lose 50% requires 100% to recover)
- Correlation vs. diversification — assets can appear uncorrelated until they're not
- Tail risk — fat tails exist, normal distribution assumptions kill accounts
- Circuit breaker design — pre-define shutdown conditions before they're needed
- Position sizing under drawdown — scale back as drawdown increases, never average down on a broken strategy

### INTELLIGENCE DESK

**Purpose:** The brain layer. Cuts across every desk. Runs nightly.

**Jobs and their bots:**
- `memory_consolidation` — Consolidator Bot × 1. Reads all episodes from last 24 hours. Extracts semantic facts. Updates procedures. Prunes dead memories.
- `performance_attribution` — Attribution Bot × 1. Why did the desk make or lose money. Which bots are learning vs. getting lucky.
- `learning_distribution` — Distribution Bot × 1. Pushes cross-desk learnings to shared semantic memory.
- `reporting` — Reporter Bot × 1. Daily report to You at 8am. Plain language, not dashboards.

**Task types:**
- `read_recent_episodes`, `extract_semantic_facts`, `update_procedures`, `prune_expired_episodes`, `compute_strategy_attribution`, `compute_bot_intelligence_scores`, `flag_underperformers`, `identify_cross_desk_learnings`, `update_shared_semantic_facts`, `generate_report`, `deliver_report`

## Backtesting Rules — Non-Negotiable

These apply to every Backtest Bot run. Never skip, never shortcut.

- Always report in-sample and out-of-sample results separately. Never blend them.
- Fewer than 100 trades in the test period = statistically insufficient. Flag and do not approve.
- Must test across at least 3 distinct market regimes (bull, bear, high-volatility) separately.
- If in-sample Sharpe ratio > 2.0 — suspect overfitting. Run overfitting detection before reporting.
- Walk-forward analysis is mandatory for any strategy with more than 3 parameters.
- Slippage assumption must be explicitly stated. Default minimum: 0.05% per trade.
- Reserve 30% of historical data as holdout BEFORE any optimization begins. Never optimize on full dataset.
- A strategy passing backtest but failing forward test within 30 trades is overfit. Return to Research.
- Report maximum drawdown AND average time to recovery. Not just total return.
- Distinguish "strategy is bad" from "strategy needs different conditions." Note which regimes failed.

## The Full Trade Flow

MARKET EVENT
↓
RESEARCH DESK → detects signal → logs to tasks table
↓
ORCHESTRATOR → evaluates, routes to Strategy Desk
↓
STRATEGY DESK → Backtest Bot validates → PASS/FAIL/MARGINAL
↓
(PASS only)
RISK DESK (parallel) → approves position size
↓
EXECUTION DESK → places trade, manages position
↓
TRADE CLOSES → all desks log final episodes
↓
INTELLIGENCE DESK (nightly) → consolidates memories, attributes P&L
↓
REPORTER BOT → 8am daily report to You

## Database Conventions

All trading desk episodes must populate these fields — they were added in migration 0003:

```typescript
// On every episode written by a trading desk bot
agent_role: 'research' | 'strategy' | 'execution' | 'risk' | 'intelligence'
desk: 'prediction_markets' | 'crypto' | 'equities' | 'options' | 'general'
bot_id: string // unique identifier for the specific bot instance e.g. 'backtest-bot-1'
```

### Memory scoping rules

- Each bot retrieves episodes scoped to its own `agent_role` first
- Cross-role retrieval only via the Intelligence Desk's `learning_distribution` job
- Procedures are role + desk specific — a Backtest Bot procedure is different from a Research Bot procedure

## Build Sequence — Do Not Skip Steps

| Step | What | Dependency |
|---:|---|---|
| 1 | Schema migration 0003 (role/desk fields) | Brain Phase 6 complete |
| 2 | Trading task curriculum (replace CPI tasks) | Migration pushed |
| 3 | Paper trading task generator | Trading curriculum |
| 4 | Research Bot SKILL.md + first Scanner Bot | Task generator running |
| 5 | Strategy Bot + Backtest Bot | Research Bot live |
| 6 | Risk Bot (circuit breakers first) | Strategy Bot live |
| 7 | Execution Bot | Risk Bot approved |
| 8 | Intelligence Desk (consolidation + reporting) | All desks running |
| 9 | Orchestrator | Intelligence Desk live |
| 10 | Second desk (clone stack, new market) | Orchestrator live |

Nothing in this sequence gets built until the brain completes Phase 6. The brain is the foundation. It must prove it learns before it runs money.

## Current Build Status

✅ Brain (Phases 1-3 complete, Phase 4 in progress)
- 14 test episodes in Supabase with embeddings
- Full five-step loop implemented
- Real API keys pending (Anthropic credits + OpenAI key)

✅ Trading Desk Spec (complete)
- Full role/job/task/bot taxonomy defined
- Knowledge library priorities per desk defined
- Backtesting rules codified
- Schema additions specced (migration 0003 — not yet pushed)

🔄 Schema Migration 0003 (pending)
- `agent_role`, `desk`, `bot_id` fields not yet added to episodes/tasks/procedures
- Must be pushed before first real episodes are written

⬜ Everything else
Not started until brain Phase 6 is complete

## What NOT to Do

- Do not build trading desk bots before the brain completes Phase 6
- Do not deploy live capital before a strategy passes both backtest AND forward test
- Do not skip the Risk Desk — it is not optional infrastructure
- Do not let the Orchestrator hold code context — it holds business context only
- Do not let specialist bots hold business context — they hold domain knowledge only
- Do not run optimization on the full historical dataset — always reserve a holdout
- Do not approve a backtest with fewer than 100 trades
- Do not write episodes without `agent_role`, `desk`, and `bot_id` populated
- Do not block the Risk Desk — it runs independently of all other desks, always

## The Goal

When the trading desk is complete:
- Research Bots scan markets 24/7 and surface opportunities autonomously
- Strategy Bots validate every idea before a dollar is risked
- Execution Bots place and manage trades without intervention
- Risk Bot enforces limits and can shut the desk down autonomously
- Intelligence Desk consolidates learnings nightly and reports to You at 8am
- Every bot gets smarter with every trade

The desk shares institutional memory — what one bot learns, all bots inherit.

Offices of traders. Each one learning. Each one remembering.

All sharing the same institutional memory.
