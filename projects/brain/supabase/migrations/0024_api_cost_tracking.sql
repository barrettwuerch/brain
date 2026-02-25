-- 0024_api_cost_tracking.sql

create table if not exists public.api_cost_log (
  id uuid primary key default gen_random_uuid(),
  logged_at timestamptz not null default now(),
  model text not null,
  cost_usd numeric(8,6) not null,
  task_type text,
  bot_id text
);

create index if not exists idx_api_cost_log_logged_at on public.api_cost_log(logged_at desc);
