-- 0022_approved_with_caveats_and_statuses.sql

alter table public.research_findings drop constraint if exists research_findings_status_check;

alter table public.research_findings
  add constraint research_findings_status_check
  check (
    status in (
      'under_investigation',
      'formalized',
      'challenged',
      'backtested',
      'approved_for_forward_test',
      'approved_with_caveats',
      'approved_for_live',
      'underperforming',
      'archived',
      'needs_revision',
      'preliminary',
      'passed_to_backtest',
      'in_backtest'
    )
  );
