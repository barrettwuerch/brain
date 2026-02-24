-- THE BRAIN — Supabase schema (consolidated snapshot)
-- Goal: support ReAct + Reflexion loop with 3-layer memory + reasoning quality measurement.
-- NOTE: This file is maintained as a running snapshot. It should reflect all migrations.

-- Extensions
create extension if not exists pgcrypto;
create extension if not exists vector;

-- 1) Tasks: what the agent is asked to do
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  task_type text not null,            -- e.g. 'data_analysis' | 'prediction' | 'pattern_find'
  task_input jsonb not null,          -- raw input payload

  -- trading desk scoping (nullable; generic brain tasks don't require these)
  agent_role text,
  desk text,
  bot_id text,

  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  tags text[] not null default '{}'
);

create index if not exists tasks_created_at_idx on public.tasks (created_at desc);
create index if not exists tasks_task_type_idx on public.tasks (task_type);
create index if not exists tasks_agent_role_idx on public.tasks (agent_role);
create index if not exists tasks_desk_idx on public.tasks (desk);
create index if not exists tasks_bot_id_idx on public.tasks (bot_id);

-- 2) Episodic memory: one episode per completed run
create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  task_id uuid references public.tasks(id) on delete set null,
  task_type text not null,
  task_input jsonb not null,

  -- trading desk scoping (nullable; generic brain episodes don't require these)
  agent_role text,
  desk text,
  bot_id text,

  reasoning text not null,            -- ReAct-style externalized reasoning
  action_taken jsonb not null,        -- exact action(s) performed
  observation jsonb not null,         -- exact result from the world
  reflection text not null,           -- Reflexion-style reflection
  lessons text[] not null default '{}',

  outcome text not null check (outcome in ('correct','incorrect','partial')),
  outcome_score double precision not null check (outcome_score >= 0 and outcome_score <= 1),
  reasoning_score double precision not null check (reasoning_score >= 0 and reasoning_score <= 1),
  error_type text,
  constraint episodes_error_type_check check (error_type is null or error_type in ('computation_error','strategy_error','data_quality','regime_mismatch','unknown')),

  ttl_days int not null default 30,

  -- embeddings for retrieval
  embedding vector(1536)
);

create index if not exists episodes_created_at_idx on public.episodes (created_at desc);
create index if not exists episodes_task_type_idx on public.episodes (task_type);
create index if not exists episodes_outcome_idx on public.episodes (outcome);
create index if not exists episodes_agent_role_idx on public.episodes (agent_role);
create index if not exists episodes_desk_idx on public.episodes (desk);
create index if not exists episodes_bot_id_idx on public.episodes (bot_id);
create index if not exists episodes_lessons_gin_idx on public.episodes using gin (lessons);
create index if not exists episodes_error_type_idx on public.episodes (error_type) where error_type is not null;

-- Vector index for similarity search (requires enough rows to be effective)
create index if not exists episodes_embedding_ivfflat_idx
  on public.episodes using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 0004: Vector similarity search helper for episodes (expanded return payload)
-- (Drop+create is handled in migrations; this is the final function definition.)
create or replace function public.match_episodes(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (
  id uuid,
  created_at timestamptz,
  task_type text,
  outcome text,
  outcome_score double precision,
  reasoning_score double precision,
  reasoning text,
  action_taken jsonb,
  observation jsonb,
  reflection text,
  similarity double precision
)
language sql stable
as $$
  select
    e.id,
    e.created_at,
    e.task_type,
    e.outcome,
    e.outcome_score,
    e.reasoning_score,
    e.reasoning,
    e.action_taken,
    e.observation,
    e.reflection,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.episodes e
  where e.embedding is not null
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

-- 3) Semantic memory: distilled facts extracted from episodes
create table if not exists public.semantic_facts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),

  domain text not null,               -- what task types this applies to
  fact text not null,
  fact_type text not null default 'success_pattern' check (fact_type in ('success_pattern','failure_pattern')),

  supporting_episode_ids uuid[] not null default '{}',

  confidence double precision not null check (confidence >= 0 and confidence <= 1),
  times_confirmed int not null default 0,
  times_violated int not null default 0,

  status text not null default 'active' check (status in ('active','flagged','retired'))
);

create index if not exists semantic_facts_domain_idx on public.semantic_facts (domain);
create index if not exists semantic_facts_status_idx on public.semantic_facts (status);
create index if not exists semantic_facts_updated_idx on public.semantic_facts (last_updated desc);

-- 4) Procedural memory: learned playbooks per task type
create table if not exists public.procedures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),

  task_type text not null,

  -- trading desk scoping (nullable; generic brain procedures don't require these)
  agent_role text,
  desk text,
  bot_id text,

  approach text[] not null default '{}',
  cautions text[] not null default '{}',
  success_pattern text,
  failure_pattern text,

  avg_success_rate double precision,
  status text not null default 'active' check (status in ('active','flagged','retired'))
);

create unique index if not exists procedures_task_type_unique on public.procedures (task_type);
create index if not exists procedures_status_idx on public.procedures (status);
create index if not exists procedures_agent_role_idx on public.procedures (agent_role);
create index if not exists procedures_desk_idx on public.procedures (desk);
create index if not exists procedures_bot_id_idx on public.procedures (bot_id);

-- 5) Intelligence scores: time series metrics of reasoning quality
-- is_score range: approximately -0.3 to 1.0
-- NOT -1 to +1 as sometimes stated.
-- Floor is ~-0.3 because calibration (Spearman correlation)
-- contributes a minimum of -0.20, while outcome and reasoning
-- scores floor at 0.0 (they are 0/1 binary inputs).
-- Thresholds PAUSED (-0.10) and EXPLOITING (+0.10) are both
-- within the realistic range and are correct as specified.
-- Do not normalize IS assuming -1 floor — use 0 as practical floor
-- for any display or bucketing logic.
create table if not exists public.intelligence_scores (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  window_start timestamptz,
  window_end timestamptz,

  metric text not null,               -- e.g. 'accuracy', 'calibration', 'transfer_score'
  task_type text,
  value double precision not null,
  notes text,

  supporting_episode_ids uuid[] not null default '{}'
);

create index if not exists intelligence_scores_created_at_idx on public.intelligence_scores (created_at desc);
create index if not exists intelligence_scores_metric_idx on public.intelligence_scores (metric);
create index if not exists intelligence_scores_task_type_idx on public.intelligence_scores (task_type);

-- 6) Behavioral state machine tables
create table if not exists public.bot_states (
  bot_id text primary key,
  agent_role text not null,
  desk text not null,

  current_state text not null default 'exploiting'
    check (current_state in ('exploiting','cautious','paused','diagnostic','recovering')),
  -- CAUTIOUS exits:
  -- → EXPLOITING if IS > 0.05 for 3 consecutive evaluations
  -- → PAUSED if IS < -0.10 on latest evaluation
  -- No manual review required for either transition
  state_since timestamptz not null default now(),
  reason text,
  requires_manual_review boolean not null default false,

  warm_up boolean not null default true,
  warm_up_episodes_remaining int not null default 20,

  is_at_entry float,

  consecutive_wins int not null default 0,
  consecutive_losses int not null default 0,
  trades_in_state int not null default 0,
  good_is_windows int not null default 0,

  peak_outcome_score float,
  current_drawdown float,
  drawdown_velocity float,
  profit_factor float,

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

-- 7) Research desk findings
create table if not exists public.research_findings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bot_id text not null,
  desk text not null default 'prediction_markets',
  market_type text not null default 'prediction' check (market_type in ('prediction','crypto','equity','options')),
  agent_role text not null default 'research',

  finding_type text not null
    check (finding_type in ('live_edge','dead_end','preliminary','under_investigation')),
  edge_type text not null
    check (edge_type in (
      'behavioral',
      'structural_flow',
      'liquidity',
      'microstructure',
      'correlated_arbitrage',
      'late_resolution',
      'information_asymmetry'
    )),

  description text not null,
  mechanism text,
  failure_conditions text,
  market text,
  regime_notes text,

  rqs_score float,
  rqs_components jsonb,

  sample_size int,
  observed_rate float,
  base_rate float,
  lift float,
  out_of_sample boolean default false,

  status text not null default 'under_investigation'
    check (status in ('preliminary','under_investigation','passed_to_backtest','in_backtest','approved_for_live','archived')),
  recommendation text
    check (recommendation in ('pass_to_backtest','investigate_further','archive') or recommendation is null),
  backtest_result text,

  supporting_episode_ids uuid[] default '{}',
  notes text
);

create index if not exists rf_bot_id_idx on public.research_findings (bot_id);
create index if not exists rf_market_type_idx on public.research_findings (market_type);
create index if not exists rf_status_idx on public.research_findings (status);
create index if not exists rf_finding_type_idx on public.research_findings (finding_type);
create index if not exists rf_edge_type_idx on public.research_findings (edge_type);
create index if not exists rf_rqs_idx on public.research_findings (rqs_score desc);

-- 8) Knowledge library (stub)
create table if not exists public.knowledge_library (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,
  source text not null,
  domain text not null,
  agent_role text,
  content text not null,
  embedding vector(1536),
  updated_at timestamptz not null default now()
);

create index if not exists kl_domain_idx on public.knowledge_library (domain);
create index if not exists kl_agent_role_idx on public.knowledge_library (agent_role);

-- 9) Positions (paper trading + live tracking)
create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  bot_id text not null,
  desk text not null,
  market_type text not null default 'prediction' check (market_type in ('prediction','crypto','equity','options')),
  strategy_id text,

  market_ticker text not null,

  status text not null default 'open' check (status in ('open','closed','partially_closed')),
  side text not null check (side in ('yes','no')),

  entry_price float not null,
  current_price float,
  size int not null,
  remaining_size int not null,

  unrealized_pnl float default 0,
  realized_pnl float default 0,
  peak_price float,

  stop_level float not null,
  profit_target float not null,
  slippage_assumed float not null,

  closed_at timestamptz,
  exit_price float,
  exit_reason text check (exit_reason in ('profit_target','stop_loss','time_exit','circuit_breaker','manual') or exit_reason is null),

  entry_episode_id uuid,
  exit_episode_id uuid
);

create index if not exists positions_bot_id_idx on public.positions (bot_id);
create index if not exists positions_status_idx on public.positions (status);
create index if not exists positions_desk_idx on public.positions (desk);
create index if not exists positions_ticker_idx on public.positions (market_ticker);
create index if not exists positions_strategy_idx on public.positions (strategy_id);
create index if not exists positions_market_type_idx on public.positions (market_type);

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

-- 10) Watch conditions (Scanner Bot)
create table if not exists public.watch_conditions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  strategy_id text not null,
  bot_id text not null,
  market_type text not null check (market_type in ('prediction','crypto','equity','options')),
  ticker text not null,

  condition_type text not null check (condition_type in ('threshold','crossover','anomaly','regime')),
  metric text not null,
  operator text not null check (operator in ('>','<','>=','<=','==','crosses_above','crosses_below')),
  value float not null,
  timeframe text not null default '1h',

  action_type text not null check (action_type in ('place_limit_order','alert_only')),
  action_params jsonb not null default '{}',

  max_triggers_per_day int not null default 3,
  cooldown_minutes int not null default 60,
  active_hours text,
  vol_regime_gate text,

  status text not null default 'active' check (status in ('active','paused','expired','max_reached')),
  last_triggered timestamptz,
  trigger_count int not null default 0,
  expires_at timestamptz,

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

-- 11) Strategy outcomes (forward-test feedback loop)
create table if not exists public.strategy_outcomes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Identity
  strategy_id text not null,
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

  status text not null default 'accumulating'
    check (status in ('accumulating','sufficient','approved','underperforming','retired')),

  watch_condition_id text,
  last_trade_at timestamptz,
  evaluated_at timestamptz
);

create index if not exists so_strategy_idx on public.strategy_outcomes (strategy_id);
create index if not exists so_status_idx on public.strategy_outcomes (status);
create index if not exists so_market_type_idx on public.strategy_outcomes (market_type);

-- 12) Orchestrator
-- No dedicated tables yet. Orchestrator coordinates tasks, reads bot states, and logs escalations.

-- Phase 1 RLS posture (developer-friendly): public read; writes via service role.
-- You can tighten later with auth.
alter table public.tasks enable row level security;
alter table public.episodes enable row level security;
alter table public.semantic_facts enable row level security;
alter table public.procedures enable row level security;
alter table public.intelligence_scores enable row level security;

drop policy if exists "Public read" on public.tasks;
create policy "Public read" on public.tasks for select using (true);

drop policy if exists "Public read" on public.episodes;
create policy "Public read" on public.episodes for select using (true);

drop policy if exists "Public read" on public.semantic_facts;
create policy "Public read" on public.semantic_facts for select using (true);

drop policy if exists "Public read" on public.procedures;
create policy "Public read" on public.procedures for select using (true);

drop policy if exists "Public read" on public.intelligence_scores;
create policy "Public read" on public.intelligence_scores for select using (true);
