-- 0011_positions_market_type.sql

alter table public.positions
  add column if not exists market_type text not null default 'prediction';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'positions_market_type_check'
  ) then
    alter table public.positions
      add constraint positions_market_type_check
      check (market_type in ('prediction','crypto','equity','options'));
  end if;
end $$;

create index if not exists positions_market_type_idx on public.positions (market_type);
