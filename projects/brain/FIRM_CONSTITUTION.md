# THE FIRM — Constitution

## Mission
Build a self-improving trading firm that compounds capital across two horizons: active prediction market trading (Front Office, 30-day) and long-term investment holdings (Back Office, multi-year). The Back Office does not get built until the Front Office proves itself.

## Capital Preservation Rules (inviolable — no bot can override)
- Maximum drawdown from equity peak: 15%. All trading halts if breached.
- No single strategy > 30% of deployed capital.
- No single market category > 40% of deployed capital.
- Minimum cash reserve: 20% of capital, never deployed.
- No live trading without 30+ forward test trades matching backtest within 30%.

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

## Market Expansion Rules
- New market adapter requires before paper trading begins: tasks.ts, compute.ts, data_feed.ts, SKILL addendum, market-specific Risk Bot circuit breakers
- Build order: crypto → equities → options
- No new market paper trading until prior market has 30+ verified paper trades
- No two new adapters built simultaneously
- Brain loop, memory layer, state machine: never forked per market
- Alpaca is the execution layer for crypto + equities + options
