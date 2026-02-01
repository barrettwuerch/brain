# Run WRP Worker as a macOS Service (launchd)

This guide lets you keep the WRP worker running on your Mac **without keeping a terminal open**.

You’ll create a `launchd` agent (runs under your user account).

---

## Pick your backend
### Option A: SQLite (simplest laptop mode)
- DB file: `~/wrp/wrp.db`
- No Postgres needed

### Option B: Postgres.app (still laptop-friendly)
- DSN: `postgres://wrp:wrp_pw@localhost:5432/wrp`
- Requires Postgres.app running

---

## 1) Create a wrapper script
`launchd` is happiest when you run a small script.

Create:

`~/wrp/run_wrp_worker.sh`

```bash
#!/bin/bash
set -euo pipefail

# Ensure Postgres.app tools are available if you use pg_isready/pg_dump/etc.
export PATH="/Applications/Postgres.app/Contents/Versions/18/bin:$PATH:$HOME/Library/Python/3.9/bin"

# Point this at the WRP repo
WRP_DIR="/Users/bear/.openclaw/workspace/projects/agent-economy/webhook-reliability-pack"
cd "$WRP_DIR"

# Choose ONE backend:

# --- SQLite ---
# DB="$HOME/wrp/wrp.db"
# python3 -m wrp.cli --sqlite "$DB" init
# exec python3 -m wrp.cli --sqlite "$DB" worker

# --- Postgres ---
export WRP_DSN='postgres://wrp:wrp_pw@localhost:5432/wrp'
python3 -m wrp.cli --postgres "$WRP_DSN" init
exec python3 -m wrp.cli --postgres "$WRP_DSN" worker
```

Make it executable:
```bash
chmod +x ~/wrp/run_wrp_worker.sh
```

Notes:
- We run `init` on startup so schema is always present.
- The script uses `exec` so the worker becomes the main process (better logging/restarts).

---

## 2) Create a launchd plist
Create:

`~/Library/LaunchAgents/ai.openclaw.wrp.worker.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>ai.openclaw.wrp.worker</string>

    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>/Users/bear/wrp/run_wrp_worker.sh</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/Users/bear/wrp/wrp-worker.out.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/bear/wrp/wrp-worker.err.log</string>

    <key>WorkingDirectory</key>
    <string>/Users/bear/.openclaw/workspace/projects/agent-economy/webhook-reliability-pack</string>

    <!-- Avoid rapid restart loops if something fails instantly -->
    <key>ThrottleInterval</key>
    <integer>10</integer>
  </dict>
</plist>
```

---

## 3) Load and start the service
```bash
launchctl unload ~/Library/LaunchAgents/ai.openclaw.wrp.worker.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/ai.openclaw.wrp.worker.plist
launchctl start ai.openclaw.wrp.worker
```

Check status:
```bash
launchctl list | grep ai.openclaw.wrp.worker
```

View logs:
```bash
tail -n 200 ~/wrp/wrp-worker.out.log
tail -n 200 ~/wrp/wrp-worker.err.log
```

Stop it:
```bash
launchctl stop ai.openclaw.wrp.worker
```

Disable/uninstall:
```bash
launchctl unload ~/Library/LaunchAgents/ai.openclaw.wrp.worker.plist
rm ~/Library/LaunchAgents/ai.openclaw.wrp.worker.plist
```

---

## Common issues
### Worker keeps restarting
- Check `~/wrp/wrp-worker.err.log` first.
- Common causes:
  - Postgres.app is not running (if using Postgres)
  - Python deps not installed (`pip install -r requirements.txt`)
  - Wrong path in `WRP_DIR`

### You changed Python versions
If your `python3` points somewhere else, adjust the wrapper script to use the right interpreter.

---

## Recommended next upgrade (when you care)
Add lightweight alerting:
- a cron/launchd health check that runs `wrp status` and notifies you if DLQ > 0
