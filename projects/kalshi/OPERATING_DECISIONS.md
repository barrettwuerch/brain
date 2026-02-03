# Operating decisions (Bear)

Captured: 2026-02-03

## Trading schedule
- Run 24/7.
- Do NOT require a daily “acknowledge report to continue” gate.
- Still generate daily logs/reports and learn from results.

## Scope / market types
- Start with **mention markets** only.
- Expand later after validation.

## Kill switch / stop mechanism
- Bear will manually tell the agent to stop (chat command) for now.
- Engineering note: we will ALSO keep an out-of-band kill switch (local file) for safety in case chat is unavailable.
