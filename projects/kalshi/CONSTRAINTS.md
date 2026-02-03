# Kalshi Bot Constraints (Bear)

- **No manual trading as part of the system.** Bear will not be making discretionary/interactive trades day-to-day.
- Any manual trading is only an occasional “fun with friends on the weekend” activity and is out-of-scope for this bot.
- Therefore: **omit operator-confirmation flows and operator FV override inputs** from the core design.
- Operating preference: run **24/7**; do not require daily acknowledgement gating.
- The bot should operate autonomously within strict risk guardrails, with reporting/alerts for oversight.
- Stop mechanism: Bear may request a manual stop via chat, but we will also keep an out-of-band local kill switch for safety.
