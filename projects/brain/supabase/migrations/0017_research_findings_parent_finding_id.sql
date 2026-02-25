-- 0017_research_findings_parent_finding_id.sql

alter table public.research_findings
  add column if not exists parent_finding_id uuid references public.research_findings(id) on delete set null;

comment on column public.research_findings.parent_finding_id is 'If this finding was generated as a next-generation hypothesis from a failed strategy, this references the parent finding that failed. NULL for original research findings.';
