-- 0004_match_episodes_return_more.sql
-- Expand match_episodes RPC return payload so memory injection can include what was actually done.

drop function if exists public.match_episodes(vector(1536), int);

create function public.match_episodes(
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
  reasoning text,
  action_taken jsonb,
  observation jsonb,
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
    e.reasoning,
    e.action_taken,
    e.observation,
    e.reflection,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.episodes e
  where e.embedding is not null
  order by e.embedding <=> query_embedding
  limit match_count;
$$;
