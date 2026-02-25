-- 0027_watch_conditions_size_position.sql
-- Allow size_position action type for watch_conditions (scanner → risk sizing → continuation)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'watch_conditions'
      AND constraint_name = 'watch_conditions_action_type_check'
  ) THEN
    ALTER TABLE public.watch_conditions
      DROP CONSTRAINT watch_conditions_action_type_check;
  END IF;

  ALTER TABLE public.watch_conditions
    ADD CONSTRAINT watch_conditions_action_type_check
    CHECK (action_type in ('place_limit_order','size_position','alert_only'));
END $$;
