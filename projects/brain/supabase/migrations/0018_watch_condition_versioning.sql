-- 0018_watch_condition_versioning.sql

alter table public.watch_conditions
  add column if not exists version int not null default 1;

alter table public.watch_conditions
  add column if not exists superseded_by uuid;

-- Allow superseded status for versioned conditions
alter table public.watch_conditions drop constraint if exists watch_conditions_status_check;
alter table public.watch_conditions
  add constraint watch_conditions_status_check
  check (status in ('active','paused','expired','max_reached','superseded'));

comment on column public.watch_conditions.version is 'Increments when condition parameters are updated. Old versions have status=superseded and superseded_by pointing to the new condition id.';
comment on column public.watch_conditions.superseded_by is 'If this condition was replaced by an updated version, this field contains the new watch_condition id. NULL for active/current conditions.';
