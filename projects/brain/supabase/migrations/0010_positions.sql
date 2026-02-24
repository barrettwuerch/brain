-- 0010_positions.sql

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Identity
  bot_id text not null,
  desk text not null,
  strategy_id text,

  market_ticker text not null,

  -- Position state
  status text not null default 'open' check (status in ('open','closed','partially_closed')),
  side text not null check (side in ('yes','no')),

  -- Sizing
  entry_price float not null,
  current_price float,
  size int not null,
  remaining_size int not null,

  -- P&L
  unrealized_pnl float default 0,
  realized_pnl float default 0,
  peak_price float,

  -- Risk controls
  stop_level float not null,
  profit_target float not null,
  slippage_assumed float not null,

  -- Resolution
  closed_at timestamptz,
  exit_price float,
  exit_reason text check (exit_reason in ('profit_target','stop_loss','time_exit','circuit_breaker','manual') or exit_reason is null),

  -- Links
  entry_episode_id uuid,
  exit_episode_id uuid
);

create index if not exists positions_bot_id_idx on public.positions (bot_id);
create index if not exists positions_status_idx on public.positions (status);
create index if not exists positions_desk_idx on public.positions (desk);
create index if not exists positions_ticker_idx on public.positions (market_ticker);
create index if not exists positions_strategy_idx on public.positions (strategy_id);

-- Trigger: auto-update updated_at on any row change
create or replace function public.update_positions_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists positions_updated_at on public.positions;
create trigger positions_updated_at
  before update on public.positions
  for each row execute function public.update_positions_updated_at();
