-- 0014_strategy_outcomes.sql
-- Forward-test performance aggregation per strategy (research_finding)

create table if not exists public.strategy_outcomes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Identity
  strategy_id text not null, -- research_findings.id
  market_type text not null check (market_type in ('prediction','crypto','equity','options')),
  desk text not null,

  -- Trade summary
  total_trades int not null default 0,
  winning_trades int not null default 0,
  losing_trades int not null default 0,
  win_rate float,
  avg_win float,
  avg_loss float,
  profit_factor float,
  total_pnl float not null default 0,
  max_drawdown float,

  -- Backtest comparison
  backtest_win_rate float,
  backtest_pnl float,
  matches_backtest boolean,
  divergence_pct float,

  -- Regime context
  dominant_regime text,
  regime_breakdown jsonb,

  -- Status
  status text not null default 'accumulating'
    check (status in ('accumulating','sufficient','approved','underperforming','retired')),

  -- Links
  watch_condition_id text,
  last_trade_at timestamptz,
  evaluated_at timestamptz
);

create index if not exists so_strategy_idx on public.strategy_outcomes (strategy_id);
create index if not exists so_status_idx on public.strategy_outcomes (status);
create index if not exists so_market_type_idx on public.strategy_outcomes (market_type);
