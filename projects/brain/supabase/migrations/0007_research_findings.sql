-- 0007_research_findings.sql

create table if not exists public.research_findings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bot_id text not null,
  desk text not null default 'prediction_markets',
  agent_role text not null default 'research',

  -- Classification
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

  -- Content
  description text not null,
  mechanism text,
  failure_conditions text,
  market text,
  regime_notes text,

  -- Research Quality Score
  rqs_score float,
  rqs_components jsonb,

  -- Statistical evidence
  sample_size int,
  observed_rate float,
  base_rate float,
  lift float,
  out_of_sample boolean default false,

  -- Lifecycle
  status text not null default 'under_investigation'
    check (status in ('under_investigation','passed_to_backtest','in_backtest','archived','deployed')),
  recommendation text
    check (recommendation in ('pass_to_backtest','investigate_further','archive') or recommendation is null),
  backtest_result text,

  -- Links
  supporting_episode_ids uuid[] default '{}',
  notes text
);

create index if not exists rf_bot_id_idx on public.research_findings (bot_id);
create index if not exists rf_status_idx on public.research_findings (status);
create index if not exists rf_finding_type_idx on public.research_findings (finding_type);
create index if not exists rf_edge_type_idx on public.research_findings (edge_type);
create index if not exists rf_rqs_idx on public.research_findings (rqs_score desc);
