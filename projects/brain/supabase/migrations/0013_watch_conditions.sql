-- 0013_watch_conditions.sql

create table if not exists public.watch_conditions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Identity
  strategy_id text not null,
  bot_id text not null,
  market_type text not null check (market_type in ('prediction','crypto','equity','options')),
  ticker text not null,

  -- The trigger condition
  condition_type text not null check (condition_type in ('threshold','crossover','anomaly','regime')),
  metric text not null,
  operator text not null check (operator in ('>','<','>=','<=','==','crosses_above','crosses_below')),
  value float not null,
  timeframe text not null default '1h',

  -- What to do when triggered
  action_type text not null check (action_type in ('place_limit_order','alert_only')),
  action_params jsonb not null default '{}',

  -- Risk controls on the condition itself
  max_triggers_per_day int not null default 3,
  cooldown_minutes int not null default 60,
  active_hours text,
  vol_regime_gate text,

  -- Lifecycle
  status text not null default 'active' check (status in ('active','paused','expired','max_reached')),
  last_triggered timestamptz,
  trigger_count int not null default 0,
  expires_at timestamptz,

  -- Audit
  registered_by text not null default 'orchestrator'
);

create index if not exists wc_status_idx on public.watch_conditions (status);
create index if not exists wc_market_type_idx on public.watch_conditions (market_type);
create index if not exists wc_ticker_idx on public.watch_conditions (ticker);
create index if not exists wc_strategy_idx on public.watch_conditions (strategy_id);

create or replace function public.update_watch_conditions_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists watch_conditions_updated_at on public.watch_conditions;
create trigger watch_conditions_updated_at
  before update on public.watch_conditions
  for each row execute function public.update_watch_conditions_updated_at();
