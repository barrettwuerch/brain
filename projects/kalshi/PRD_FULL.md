# PRD (Full): Kalshi “Mention Markets” Trading System

Owner: Kindling Usdi Yona
Date: 2026-02-03
Status: Draft (for Bear review)

## 0) Executive summary
We will build a conservative Kalshi trading system focused on **mention markets** and the **market-making** approach you described:
- find suitable mention markets (right event, sufficient spread/liquidity, clear rules)
- quote both sides using **limit orders** (implemented as YES-bid + NO-bid)
- manage **inventory** and **adverse selection** (toxicity) aggressively, especially during live-event windows
- start with **paper trading** and instrumentation; only later enable live trading with confirmations and tight limits.

Key principle: **survive-first-run**. The v0 system’s job is to produce trustworthy logs and a repeatable workflow.

---

## 1) Goals
### 1.1 Tomorrow-morning goal (“test trading”)
- Run a **paper-trading** bot that:
  - discovers/selects candidate mention markets
  - ingests orderbooks/trades
  - generates quote decisions + simulated orders/fills
  - measures spread capture vs adverse selection signals
  - outputs a morning report: what markets, what would we have done, what happened.

### 1.2 Near-term goal (v1)
- Limited live trading readiness **with human-in-the-loop confirmations**:
  - bot proposes orders (place/cancel/replace)
  - user approves each state-changing action
  - strict allowlists and hard risk limits

### 1.3 Longer-term goal (v2)
- More autonomous execution within guardrails
- Better fill modeling, smarter selection, event calendars, and “toxicity-aware” quoting

---

## 2) Non-goals (for now)
- Unattended autonomous trading
- High-frequency order churn / ultra-low-latency market making
- Scraping private data or copying another trader’s private trades
- Complex ML pipelines

---

## 3) System architecture (modules)

### 3.1 Datafeed / Collector
Responsibilities:
- fetch market lists + metadata
- for selected markets, fetch/stream:
  - orderbook snapshots and/or updates
  - recent trades (optional)
- fetch account state (for live mode): balance, positions, open orders, fills

Inputs:
- Kalshi API (REST + later WS)

Outputs:
- `MarketSnapshot` objects for strategy and risk layers

### 3.2 Orderbook Builder (microstructure layer)
Important Kalshi detail: orderbook is **bids-only** for YES and NO.
- YES ask is implied by **100 - best NO bid**
- NO ask is implied by **100 - best YES bid**

Outputs (Top of book view):
- best YES bid, implied YES ask
- best NO bid, implied NO ask
- mid (if both sides present)
- spread

### 3.3 Market Selection
Goal: choose “the right markets at the right time.”

Selection scoring (v0 heuristic):
- must be open
- must have a valid spread estimate
- prefer larger spreads (net of minimum edge threshold)
- prefer non-zero liquidity/volume proxies
- optionally filter by title/series keywords (mention-like)

Output:
- `selectedMarkets: string[]` (hard allowlist for this run)

### 3.4 Strategy Engine (“Buy/Sell logic”)
We implement market-making as **two buy orders**:
- buy YES (YES-bid)
- buy NO (NO-bid)

This is equivalent to quoting both sides because:
- buying NO at price `q` implies you are willing to **sell YES** at `100-q`.

#### 3.4.1 Inputs
For each market:
- top-of-book: yesBid, impliedYesAsk, mid, spread
- inventory: current simulated (paper) or real (live) positions
- toxicity flags (recent fill-then-move, trade bursts)

#### 3.4.2 Outputs
One or more `TradeIntent` objects:
- `action`: place/cancel/replace
- `marketTicker`
- `side`: YES or NO
- `limitPriceCents`
- `qty`
- `reason`: human-readable rationale
- `validUntilMs`

#### 3.4.3 Quote placement rules (v0)
For each selected market when not paused:
1) Require `mid` and `spread`.
2) Require `spread >= minSpreadCents`.
3) Compute net inventory `inv = posYES - posNO`.
4) Compute a small `inventorySkew` (bounded integer cents) to discourage adding to existing inventory.
5) Quote prices:
   - `yesBidPx = clamp(mid - halfSpread - inventorySkew, 1, 99)`
   - `noBidPx  = clamp((100 - mid) - halfSpread + inventorySkew, 1, 99)`
6) Place orders **only if** we don’t already have an open order on that side (v0 reduces churn).

#### 3.4.4 Quote update rules (v0)
- v0: no continuous repricing; re-place only when order absent.
- v1: move (amend/cancel+replace) when:
  - top-of-book moved materially
  - inventory changed
  - toxicity regime changed
  - order is stale (> N seconds)

#### 3.4.5 “Event mode” (toxicity control)
Mention markets can jump to 0/100 quickly.
- If a fill occurs, pause quoting for `pauseAfterFillMs`.
- If repeated fill-then-move detected (v1), widen spreads or pause longer.

### 3.5 Risk Manager (hard blocks)
Always enforced even in paper trading (to validate behavior):
- kill switch file present → stop
- max open orders
- max position per market
- max error streak

Live-mode additions (v1):
- market allowlist exact tickers only
- max daily loss / drawdown
- max notional exposure
- exchange status checks

### 3.6 Execution Engine
#### Paper mode
- store “open orders” locally
- simulate fills conservatively:
  - YES buy fills if `orderPrice >= implied YES ask`
  - NO buy fills if `orderPrice >= implied NO ask`

#### Live mode (later)
- place/cancel/amend orders on Kalshi
- require human confirmation per action
- idempotency via client_order_id

### 3.7 Monitoring + Logging
Append-only JSONL log events:
- selection
- snapshot
- intent
- risk decision
- order placed/canceled/replaced
- fill
- errors

A periodic console summary:
- selected markets
- open orders
- positions
- basic “toxicity” counters

---

## 4) Data sources and APIs
- REST today: markets list + per-market orderbook
- WS later (v1/v2): orderbook deltas, trades, user fills/positions

---

## 5) Rollout plan
### 5.1 v0 (now → tomorrow morning): paper trading runner
Deliverables:
- working paper bot
- logs on disk
- a small report script (summary)

### 5.2 v1: limited live with confirmations
Deliverables:
- execution module for create/cancel/amend
- confirmation UI (CLI)
- strict allowlist and caps

### 5.3 v2: smarter market making
Deliverables:
- WS orderbook integrity (seq checks)
- toxicity regime model
- inventory skew improvements
- order-group circuit breaker integration

---

## 6) Acceptance criteria
v0:
- selects markets reliably
- produces snapshots and order/fill logs
- respects kill switch and position caps

v1:
- places/cancels only after explicit approval
- survives restarts without duplicating orders

---

## 7) Current implementation status (what exists right now)
- `projects/kalshi/PRD.md` (high-level PRD)
- `projects/kalshi/bot.mjs` (paper-trading v0 runner)
- `projects/kalshi/config.paper.json` (config)
- logs: `projects/kalshi/logs/*.jsonl`

Notes:
- You saw some earlier runs killed (SIGKILL) because I restarted iterations while refining market selection filters; the current runner is stable and selecting markets.
