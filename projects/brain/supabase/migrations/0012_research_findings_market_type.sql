-- 0012_research_findings_market_type.sql

alter table public.research_findings
  add column if not exists market_type text not null default 'prediction';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'research_findings_market_type_check'
  ) then
    alter table public.research_findings
      add constraint research_findings_market_type_check
      check (market_type in ('prediction','crypto','equity','options'));
  end if;
end $$;

create index if not exists rf_market_type_idx on public.research_findings (market_type);
