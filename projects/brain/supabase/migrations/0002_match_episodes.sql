-- 0002_match_episodes.sql
-- Vector similarity search helper for episodes.

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
    e.reflection,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.episodes e
  where e.embedding is not null
  order by e.embedding <=> query_embedding
  limit match_count;
$$;
