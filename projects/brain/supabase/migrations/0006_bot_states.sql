-- 0006_bot_states.sql
-- Behavioral state tracking for all trading desk bots.

create table if not exists public.bot_states (
  bot_id text primary key,
  agent_role text not null,
  desk text not null,

  -- Current behavioral state
  current_state text not null default 'exploiting'
    check (current_state in ('exploiting','cautious','paused','diagnostic','recovering')),
  state_since timestamptz not null default now(),
  reason text,
  requires_manual_review boolean not null default false,

  -- Warm-up tracking (new bots start here)
  warm_up boolean not null default true,
  warm_up_episodes_remaining int not null default 20,

  -- IS snapshot at state entry (for comparison during recovery)
  is_at_entry float,

  -- Streak counters
  consecutive_wins int not null default 0,
  consecutive_losses int not null default 0,
  trades_in_state int not null default 0,
  good_is_windows int not null default 0,

  -- Equity / drawdown (nullable — only for active trading desks)
  peak_outcome_score float,
  current_drawdown float,
  drawdown_velocity float,
  profit_factor float,

  -- Diagnostic tracking
  diagnostic_attempts int not null default 0,
  diagnostic_max int not null default 10,
  last_root_cause text,

  updated_at timestamptz not null default now()
);

create index if not exists bot_states_desk_idx on public.bot_states (desk);
create index if not exists bot_states_role_idx on public.bot_states (agent_role);
create index if not exists bot_states_state_idx on public.bot_states (current_state);

create table if not exists public.bot_state_transitions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bot_id text not null,
  from_state text not null,
  to_state text not null,
  reason text,
  metric_snapshot jsonb
);

create index if not exists bst_bot_id_idx on public.bot_state_transitions (bot_id);
create index if not exists bst_created_at_idx on public.bot_state_transitions (created_at desc);
