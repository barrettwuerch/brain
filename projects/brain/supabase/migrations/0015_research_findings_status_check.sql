-- 0015_research_findings_status_check.sql
-- Add forward-test outcome states to findings

alter table public.research_findings drop constraint if exists research_findings_status_check;

alter table public.research_findings
  add constraint research_findings_status_check
  check (status in (
    'preliminary',
    'under_investigation',
    'passed_to_backtest',
    'in_backtest',
    'approved_for_live',
    'archived'
  ));
