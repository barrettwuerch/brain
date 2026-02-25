-- 0020_operational_state.sql
-- Real-time operational state: sensor readings with TTL
-- NOT for accumulated knowledge (semantic_facts)
-- NOT for event history (episodes)

create table if not exists public.operational_state (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  key text not null,
  value jsonb not null,
  published_by text not null,
  published_at timestamptz not null default now(),
  ttl_seconds int not null,
  expires_at timestamptz not null,
  unique (domain, key)
);

create index if not exists idx_operational_state_domain_key on public.operational_state(domain, key);
create index if not exists idx_operational_state_expires on public.operational_state(expires_at);

-- Clean up misplaced regime state from semantic_facts
delete from public.semantic_facts where domain = 'regime_state';
