# OpenClaw Data & News API Strategy

> Authored by Bear. Captured from chat on 2026-02-03.
> This document is authoritative for the data-layer architecture and FV estimation approach.

## Critical insight
Kalshi mention markets settle based on official transcripts, but markets move during the live event.

## Three layers
1) **Event intelligence (pre-event):** schedules, market discovery, historical base rates, current news context.
2) **Live monitoring (during event):** real-time text (STT/closed captions) to detect mentions and adjust FV/quotes.
3) **Resolution data (post-event):** official transcripts to confirm, reconcile, and update base rates.

## FV model (core)
- Pre-event FV = base_rate + news_intensity_adjustment.
- During-event FV updates toward 99 on confident mention detections; decays toward 0 as time elapses without mention.
- Quoting uses FV (not just mid):
  - yesBidPx = clamp(FV - halfSpread - skew, 1, 99)
  - noBidPx  = clamp((100 - FV) - halfSpread + skew, 1, 99)

## Recommended build priorities (high impact / low cost)
1) Historical base-rate database (FOMC + White House)
2) Kalshi market→event matching
3) RSS headline aggregator
4) Opened Captions integration
(Then Deepgram STT, NewsAPI.ai enrichment, transcript scraping automation, etc.)
