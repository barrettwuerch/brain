# PRD: Kalshi Trading Bot in OpenClaw (Paper → Limited Live w/ Human-in-the-Loop)

## 1) Summary
Build an OpenClaw-based trading assistant for Kalshi that can:
- ingest market + reference data,
- generate trade recommendations from a strategy,
- enforce risk limits,
- place/cancel orders **only with explicit human confirmation** initially,
- monitor positions/orders and log outcomes.

Target: **limited live trading readiness by tomorrow morning** with **human-in-the-loop confirmations**, starting from a “paper trading” mode to validate end-to-end behavior.

---

## 2) Goals (What success looks like)
### G1 — End-to-end workflow: paper → live
- Paper trading mode that simulates order placement and fills (or uses best-effort fill modeling) and produces the same logs/telemetry as live.
- Seamless switch to live mode via configuration flag, without code changes.

### G2 — Human-in-the-loop execution (tomorrow-ready)
- Bot proposes trades (market, side, price, size, rationale, risk impact).
- User confirms each action (place/cancel/replace) before any live order is sent.

### G3 — Risk-managed execution
- Central risk manager blocks trades violating limits (exposure, daily loss, order size, market constraints).
- “Kill switch” to immediately halt new orders and optionally cancel open orders.

### G4 — Observability & auditability
- Every decision and order action is logged with timestamps, inputs, outputs, and versioned config/strategy ID.
- Simple dashboard/summary: PnL, exposure, open orders, recent actions, errors.

### G5 — Reliability
- Safe restart: on startup, bot can reconcile state from Kalshi (positions/orders) and continue monitoring without duplicating actions.

---

## 3) Non-Goals (Explicitly out of scope for v1)
- Fully autonomous live trading (no confirmations).
- High-frequency trading / low-latency optimization.
- Complex portfolio optimization across many correlated markets.
- Machine learning training pipelines.
- Sophisticated fill simulation (beyond simple models) for paper trading.
- Multi-account support and advanced permissions/roles.
- Multi-venue routing (only Kalshi).

---

## 4) Users & User Stories
### Primary user
- A single operator (Bear) running OpenClaw on a personal machine.

### Core stories (v1)
1. Configure API credentials and run the bot in **paper mode** to validate ingestion + order lifecycle end-to-end.
2. See a clear trade recommendation: *market, contract, side, limit price, size, expected edge, max loss, and why now*.
3. Explicitly approve each live order via a confirmation prompt, or reject it.
4. Set risk limits (max position, max daily loss, max open orders, max notional per market) and be confident the bot won’t exceed them.
5. Stop trading instantly (kill switch) and the bot will cease placing new orders and optionally cancel open orders.
6. Review an audit log of decisions and actions after the fact.

### Secondary stories (v2)
- Automatically manage/replace orders to maintain top-of-book position within limits.
- Multi-strategy support with portfolio-level risk.
- Alerts via messaging (Slack/iMessage/Telegram) on anomalies, fills, limit breaches.

---

## 5) Scope

### V1 (Tomorrow morning: “Limited Live” with confirmations)
**Must-have**
- Market data ingestion (Kalshi markets/orderbook) at a modest cadence.
- Strategy engine that outputs **recommendations** (not direct execution).
- Risk manager with hard blocks and readable reasons.
- Execution module that supports:
  - place limit order
  - cancel order
  - replace order (optional; can be cancel+place)
  - **requires human confirmation in live mode**
- State tracking:
  - open orders
  - positions
  - fills/trades
- Monitoring:
  - periodic summary to console + structured logs
  - error handling + backoff
- Configuration system (YAML/JSON + env vars), including a single “mode” switch: `paper|live`.
- Minimal UI:
  - CLI prompts for confirmation (or simple OpenClaw-driven UI flow)
  - one command to run.

**Nice-to-have (if time)**
- Basic alerting (message on fill, error, or limit breach).
- A simple “dry-run” mode that runs strategy + risk but never places orders.

### V2 (Next iterations)
- Smarter execution: order slicing, price improvement, queue positioning heuristics.
- Better paper fill simulation using historical orderbook snapshots.
- Multi-market portfolio risk controls (correlation-aware exposure).
- Web dashboard (local) for monitoring and controls.
- Automated confirmations via rules (auto-approve if edge>threshold and within tiny size).
- Post-trade analytics and strategy backtesting harness.

---

## 6) Functional Requirements

### Data Collector
- Fetch and cache:
  - market metadata (tick size, max/min price, contract info, expiration)
  - orderbook / best bid/ask (or full depth if available)
  - trades/ticker updates (if available)
  - account state: balances, positions, open orders
- Provide normalized internal representations:
  - `MarketSnapshot`, `OrderBook`, `Position`, `Order`, `Fill`
- Rate-limit aware, resilient to transient API failures.

### Strategy Engine
- Input: latest `MarketSnapshot` (+ optional external/manual signals).
- Output: a list of `TradeIntent` objects:
  - market_id, contract_id, side, limit_price, quantity
  - expected edge / probability estimate
  - rationale string (human-readable)
  - validity window / expiry (e.g., “good for 30s”)
- Deterministic given inputs + config (auditability).

### Risk Manager
- Validate each `TradeIntent` against:
  - max order size
  - max position per market/contract
  - max total exposure (notional or worst-case loss)
  - max number of open orders
  - max daily realized loss / drawdown limit
  - price sanity checks (within bounds, tick size aligned)
  - allow/deny lists
- Output: `ApprovedIntent` or `RejectedIntent(reason)`.
- Enforce global kill switch and trading window schedule.

### Execution Engine
- Paper mode:
  - record “orders” and simulate fills using simple rules (configurable)
- Live mode:
  - require operator confirmation before any state-changing API call
  - idempotency via stored `client_order_id`
- Reconciliation:
  - on startup, fetch open orders/positions and rebuild internal state.

### Monitoring & Logging
- Structured logs (JSONL): snapshot, intent, risk_decision, order_submitted, order_rejected, order_filled, error
- Health: last data pull timestamp, API error rate, time since last decision
- End-of-session summary: PnL (if available), intents/approvals/rejections, fills and slippage

---

## 7) Architecture (High-level)

### Data flow
1. Scheduler ticks (every 1–5s in v1).
2. Data Collector fetches market + account state.
3. Strategy Engine computes `TradeIntents`.
4. Risk Manager filters/annotates.
5. Execution Engine:
   - Paper: simulate
   - Live: prompt → submit
6. State Store updates local state and logs.
7. Monitoring emits summaries/alerts.

### Suggested modules
- `collector/` (Kalshi API client, normalization, caching)
- `strategy/` (strategy interface + v1 strategy)
- `risk/` (rules, limits, kill switch)
- `execution/` (paper broker + live broker + confirmation gate)
- `state/` (in-memory + persisted snapshots)
- `monitoring/` (logger, summaries, alerts)
- `config/` (schema + loaders + validation)
- `app/` (main loop, CLI)

---

## 8) Configuration & Guardrails
- Single config file + env overrides for secrets.
- Validate at startup; fail fast.
- Store config hash in every log event.

Example fields:
- `mode: paper|live`
- `confirmations_required: true` (forced true in live for v1)
- `enabled_markets: [...]` (hard allowlist)
- `poll_interval_ms`
- `strategy: { name, params… }`
- `risk: { max_order_qty, max_position_qty, max_daily_loss, max_open_orders, max_worst_case_loss }`
- `execution: { limit_only: true, default_tif, max_retries }`
- `kill_switch: { file_path }`

Guardrails:
- limit-only orders in v1
- small allowlist tomorrow
- min edge threshold
- cooldowns after errors/fills
- trading window
- manual confirmation required for any net exposure increase

---

## 9) Metrics
Safety/correctness:
- blocked intents by reason
- confirmations requested/accepted
- idempotency hits
- API error/rate-limit events
- data staleness

Performance:
- fill rate
- slippage vs mid at decision time
- realized/unrealized PnL
- max drawdown

Ops:
- crash-free runtime
- recovery time after errors
- restart reconciliation correctness

---

## 10) Rollout Plan (Tomorrow readiness)
### Today
- Paper end-to-end: config, collector, strategy intents, risk gates, paper execution, logs (30–60 min run)
- Live connectivity smoke test: live mode with execution disabled / empty allowlist; verify auth and state reconciliation

### Tomorrow
- Start with 1 market for first hour
- Tiny limits; confirmations required
- Monitor orders/positions/PnL/errors; kill-switch ready

---

## 11) Acceptance Criteria (V1)
- Paper mode runs 30 min w/o crash and produces sensible logs.
- Live mode fetches market + account data and proposes trades.
- Live mode requires confirmation before any order/cancel.
- Risk rules prevent oversize, outside allowlist, too many orders.
- Kill switch halts new live actions immediately.
- Restart does not duplicate orders and restores state correctly.
