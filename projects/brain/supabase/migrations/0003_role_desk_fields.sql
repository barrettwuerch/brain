-- 0003_role_desk_fields.sql
-- Add trading-desk scoping fields to core memory + queue tables.
-- These fields are REQUIRED for trading desk bots, but remain nullable to preserve generic brain use.

alter table public.episodes
  add column if not exists agent_role text,
  add column if not exists desk text,
  add column if not exists bot_id text;

alter table public.tasks
  add column if not exists agent_role text,
  add column if not exists desk text,
  add column if not exists bot_id text;

alter table public.procedures
  add column if not exists agent_role text,
  add column if not exists desk text,
  add column if not exists bot_id text;

-- Helpful indexes for scoped retrieval.
create index if not exists episodes_agent_role_idx on public.episodes (agent_role);
create index if not exists episodes_desk_idx on public.episodes (desk);
create index if not exists episodes_bot_id_idx on public.episodes (bot_id);

create index if not exists tasks_agent_role_idx on public.tasks (agent_role);
create index if not exists tasks_desk_idx on public.tasks (desk);
create index if not exists tasks_bot_id_idx on public.tasks (bot_id);

create index if not exists procedures_agent_role_idx on public.procedures (agent_role);
create index if not exists procedures_desk_idx on public.procedures (desk);
create index if not exists procedures_bot_id_idx on public.procedures (bot_id);
