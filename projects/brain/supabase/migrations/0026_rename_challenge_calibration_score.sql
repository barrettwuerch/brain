-- 0026_rename_challenge_calibration_score.sql
-- Fix 5: column semantics correction
-- Rename legacy column (challenge_failure_probability) to challenge_calibration_score (Brier score).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'strategy_outcomes'
      AND column_name = 'challenge_failure_probability'
  ) THEN
    -- rename legacy column to the correct name
    ALTER TABLE public.strategy_outcomes
      RENAME COLUMN challenge_failure_probability TO challenge_calibration_score;
  END IF;

  -- If neither exists (fresh DB), ensure the correct column exists.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'strategy_outcomes'
      AND column_name = 'challenge_calibration_score'
  ) THEN
    ALTER TABLE public.strategy_outcomes
      ADD COLUMN challenge_calibration_score numeric(6,5);
  END IF;
END $$;
