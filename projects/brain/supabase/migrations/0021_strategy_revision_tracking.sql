-- 0021_strategy_revision_tracking.sql

alter table public.research_findings
  add column if not exists revision_count int not null default 0,
  add column if not exists challenge_notes text,
  add column if not exists max_revision_cycles int not null default 2;
