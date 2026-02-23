-- Market Lens — Supabase (Postgres) schema v1
-- Phase 1 core tables: stories + insights

-- Enable useful extensions (optional)
-- create extension if not exists pgcrypto; -- for gen_random_uuid()

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  url text not null,
  title text not null,
  body text,
  published_at timestamptz,
  ingested_at timestamptz not null default now(),
  category text,
  is_processed boolean not null default false,

  -- convenience fields
  url_hash text,
  content_hash text
);

-- prevent duplicates
create unique index if not exists stories_url_unique on public.stories (url);
create index if not exists stories_ingested_at_idx on public.stories (ingested_at desc);
create index if not exists stories_published_at_idx on public.stories (published_at desc);
create index if not exists stories_is_processed_idx on public.stories (is_processed);
create index if not exists stories_source_idx on public.stories (source);

create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),

  -- cluster linkage
  story_ids uuid[] not null,

  headline text not null,
  thesis text not null,

  sectors text[] not null default '{}',
  tickers text[] not null default '{}',

  direction text not null check (direction in ('bullish','bearish','mixed','unclear')),
  conviction int not null check (conviction between 1 and 5),
  time_horizon text not null check (time_horizon in ('days','weeks','months','quarters','years')),

  second_order text[] not null default '{}',
  risks text[] not null default '{}',
  educational_context text,

  created_at timestamptz not null default now()
);

create index if not exists insights_created_at_idx on public.insights (created_at desc);
create index if not exists insights_direction_idx on public.insights (direction);
create index if not exists insights_conviction_idx on public.insights (conviction);

-- Optional: simple guard to avoid empty clusters
alter table public.insights
  add constraint insights_story_ids_nonempty check (array_length(story_ids, 1) >= 1);
