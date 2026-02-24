-- THE BRAIN — Supabase schema (Phase 1 scaffold)
-- Goal: support ReAct + Reflexion loop with 3-layer memory + reasoning quality measurement.

-- Extensions
create extension if not exists pgcrypto;
create extension if not exists vector;

-- 1) Tasks: what the agent is asked to do
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  task_type text not null,            -- e.g. 'data_analysis' | 'prediction' | 'pattern_find'
  task_input jsonb not null,          -- raw input payload

  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  tags text[] not null default '{}'
);

create index if not exists tasks_created_at_idx on public.tasks (created_at desc);
create index if not exists tasks_task_type_idx on public.tasks (task_type);

-- 2) Episodic memory: one episode per completed run
create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  task_id uuid references public.tasks(id) on delete set null,
  task_type text not null,
  task_input jsonb not null,

  reasoning text not null,            -- ReAct-style externalized reasoning
  action_taken jsonb not null,        -- exact action(s) performed
  observation jsonb not null,         -- exact result from the world
  reflection text not null,           -- Reflexion-style reflection

  outcome text not null check (outcome in ('correct','incorrect','partial')),
  outcome_score double precision not null check (outcome_score >= 0 and outcome_score <= 1),
  reasoning_score double precision not null check (reasoning_score >= 0 and reasoning_score <= 1),
  error_type text,

  ttl_days int not null default 30,

  -- embeddings for retrieval
  embedding vector(1536)
);

create index if not exists episodes_created_at_idx on public.episodes (created_at desc);
create index if not exists episodes_task_type_idx on public.episodes (task_type);
create index if not exists episodes_outcome_idx on public.episodes (outcome);

-- Vector index for similarity search (requires enough rows to be effective)
create index if not exists episodes_embedding_ivfflat_idx
  on public.episodes using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 3) Semantic memory: distilled facts extracted from episodes
create table if not exists public.semantic_facts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),

  domain text not null,               -- what task types this applies to
  fact text not null,

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

  approach text[] not null default '{}',
  cautions text[] not null default '{}',
  success_pattern text,
  failure_pattern text,

  avg_success_rate double precision,
  status text not null default 'active' check (status in ('active','flagged','retired'))
);

create unique index if not exists procedures_task_type_unique on public.procedures (task_type);
create index if not exists procedures_status_idx on public.procedures (status);

-- 5) Intelligence scores: time series metrics of reasoning quality
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
