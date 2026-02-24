-- 0008_knowledge_library.sql
-- Stub: table created now, content populated in a later phase.
-- Do not wire retrieval until content is loaded.

create table if not exists public.knowledge_library (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,
  source text not null,
  domain text not null,
  agent_role text,
  content text not null,
  embedding vector(1536),
  updated_at timestamptz not null default now()
);

create index if not exists kl_domain_idx on public.knowledge_library (domain);
create index if not exists kl_agent_role_idx on public.knowledge_library (agent_role);

-- Vector index added after embedding population:
-- create index kl_embedding_idx on public.knowledge_library
--   using ivfflat (embedding vector_cosine_ops) with (lists = 50);
