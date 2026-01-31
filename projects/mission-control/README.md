# Mission Control (MVP)

A lightweight local dashboard for tracking the workstreams and sub-agent runs.

## Run
From the workspace root:

```bash
python3 -m http.server 8099 --directory projects/mission-control
```

Then open:
- http://localhost:8099

## Files
- `state.json` — single source of truth for the dashboard (updated by tools/scripts)
- `index.html` — UI

## Notes
- This is local-only.
- No external posting or money actions.
