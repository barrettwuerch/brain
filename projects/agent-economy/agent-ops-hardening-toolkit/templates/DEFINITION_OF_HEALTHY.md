# Definition of Healthy (Template)

Use this as the operator-facing "is it working?" checklist.

## The agent is HEALTHY when
- It has successfully completed its main loop/work cycle within the last: **___ minutes**
- Error rate is below: **___%** (or fewer than **___ errors** per hour)
- It is not stuck (no single step running longer than: **___ minutes**)
- Disk usage is bounded (logs within retention policy)
- External dependencies are reachable (or failing gracefully with retries)

## Quick checks (5 minutes)
1) Process is running:
   - command: `___`
2) Last success timestamp:
   - location: `___` (log line, state file, DB row)
3) Error streak:
   - location: `___`
4) Queue/backlog depth (if applicable):
   - location: `___`

## If NOT healthy
- Run: `___` (restart command)
- Check: `___` (logs)
- Notify: `___` (alert destination)
- Rollback: `___` (git revert / release rollback)
