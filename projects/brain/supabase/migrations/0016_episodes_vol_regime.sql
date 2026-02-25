-- 0016_episodes_vol_regime.sql

alter table public.episodes
  add column if not exists vol_regime text;

comment on column public.episodes.vol_regime is 'Market regime at time episode was created. Values: low | normal | elevated | extreme | unknown. Populated at episode creation time from latest volatility_regime_detect semantic fact. NULL for legacy episodes created before this migration.';
