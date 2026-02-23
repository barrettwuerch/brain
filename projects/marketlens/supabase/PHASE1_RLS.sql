-- Phase 1 RLS posture (simple)

-- insights: public read
alter table public.insights enable row level security;
create policy "Public read" on public.insights
  for select
  using (true);

-- stories: public read
alter table public.stories enable row level security;
create policy "Public read" on public.stories
  for select
  using (true);

-- Note:
-- Worker uses service role key and can write regardless of RLS.
-- Frontend uses anon key; without INSERT/UPDATE policies it will be read-only.
