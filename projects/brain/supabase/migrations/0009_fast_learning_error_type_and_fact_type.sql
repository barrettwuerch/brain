-- 0009_fast_learning_error_type_and_fact_type.sql

-- Episodes: constrain error_type to known values (nullable).
alter table public.episodes
  add column if not exists error_type text;

-- Add / enforce check constraint if missing.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'episodes_error_type_check'
  ) then
    alter table public.episodes
      add constraint episodes_error_type_check
      check (error_type is null or error_type in (
        'computation_error',
        'strategy_error',
        'data_quality',
        'regime_mismatch',
        'unknown'
      ));
  end if;
end $$;

create index if not exists episodes_error_type_idx
  on public.episodes (error_type)
  where error_type is not null;

-- Semantic facts: add fact_type for success vs failure patterns.
alter table public.semantic_facts
  add column if not exists fact_type text default 'success_pattern';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'semantic_facts_fact_type_check'
  ) then
    alter table public.semantic_facts
      add constraint semantic_facts_fact_type_check
      check (fact_type in ('success_pattern','failure_pattern'));
  end if;
end $$;
