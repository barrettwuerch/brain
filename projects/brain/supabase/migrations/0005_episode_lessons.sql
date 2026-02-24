-- 0005_episode_lessons.sql
-- Store reflection-derived lessons as structured data for reporting.

alter table public.episodes
  add column if not exists lessons text[] not null default '{}';

create index if not exists episodes_lessons_gin_idx on public.episodes using gin (lessons);
