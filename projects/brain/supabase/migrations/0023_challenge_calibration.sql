-- 0023_challenge_calibration.sql
-- NOTE: Column semantics are Brier score (lower is better), NOT a probability.

alter table public.strategy_outcomes
  add column if not exists challenge_calibration_score numeric(6,5);
