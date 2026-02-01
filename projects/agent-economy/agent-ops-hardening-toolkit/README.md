# Agent Ops Hardening Toolkit

Implements the PRD: `projects/agent-economy/PRD_agent_ops_hardening_90min.md`.

This is a reusable toolkit to deliver the 90-minute hardening engagement consistently:
- intake checklist
- triage rubric
- retry/backoff wrapper snippets
- watchdog (staleness heartbeat + checker)
- log retention script
- runbook template

## What’s in templates/
- `INTAKE_CHECKLIST.md` — pre-engagement intake checklist
- `RUNBOOK_TEMPLATE.md` — operator runbook skeleton
- `DEFINITION_OF_HEALTHY.md` — the 5-minute health check sheet
- `TRIAGE_RUBRIC.md` — how to spend the 90 minutes wisely

## Next
Add concrete copy/paste artifacts:
- watchdog scripts (heartbeat writer + checker)
- retry/backoff wrappers (Python + Node)
- log retention helpers
