# Kalshi Bot TODO (next steps)

## Immediate (v0.5) — based on Bear PRD v1 review
1) **Mention market discovery (real):** stop selecting random non-mention markets.
   - Add series/event-based discovery + pagination.
   - Provide explicit allowlist option.

2) **Stale quote protection (highest priority):**
   - Track existing paper orders per market+side.
   - Cancel + replace when |orderPrice - mid| > staleThresholdCents.

3) **Depth=1 orderbook fetch:**
   - Switch REST calls to depth=1 (top-of-book only) since v0 uses only top-of-book.

4) **Event time windows:**
   - Fetch market metadata on selection.
   - Implement: pre-event/live/post-event safety windows.

5) **Fill-then-move metric + toxicity flags:**
   - Track mid at fill and mid after 5/10/30s.
   - Flag toxic regimes; widen/pause accordingly.

6) **Morning report generator:**
   - Summarize logs (fills, spread distribution, adverse selection metrics, error counts).

## Later (v1)
- WebSocket ingestion (orderbook deltas, trades).
- Shadow-live mode (no execution) and then human-confirmed live.
- Fee-aware PnL model.
