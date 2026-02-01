# Claude draft — logger (reference)

This is a pasted draft from Claude describing a more modular, packaged `src/logger.py` design.

**Note:** This is *not* a drop-in patch; it assumes `src/config.py` and `src/utils.py` modules that don’t exist in this repo today. We’re keeping it here as a future refactor target.

---

```python
#!/usr/bin/env python3
""" Logger — Polymarket 15m Crypto Bot

Continuously polls Polymarket CLOB and Coinbase spot to produce JSONL snapshots
for BTC/ETH 15-minute Up/Down markets.

Output: one JSONL file per day in data/ with event types:
- "rollover" → new slug detected for an asset
- "snapshot" → full market + orderbook + spot snapshot
- "error" → fetch or parse failure (with details)

Usage:
  python3 -m src.logger --poll 2
  python3 -m src.logger --poll 5 --assets BTC --data-dir /tmp/poly-data
"""

# (full draft omitted here for brevity in this snippet if needed)
```

---

Full draft text was provided in chat; if we want the entire exact body preserved verbatim, paste it into this file below this line.
