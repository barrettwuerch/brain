# Plan update (aligning build to North Star + Aggressive Risk Structure)

Captured: 2026-02-03

## What changes immediately
- Risk model becomes **percentage-based and auto-scaling** (not fixed contract counts).
- We target **high market coverage** and **fill-rate improvements** as the main growth lever.
- We shift from “spread capturer” to “news trader” by prioritizing the intelligence roadmap:
  - rules/keyword extraction → FV (base rates + news) → news spike detection → co-occurrence → conviction sizing.

## What does NOT change
- We still build phases: paper → smarter paper → shadow → live.
- We still require strict kill switch + drawdown halts + adverse selection defenses.
- We still keep mention markets only at first.

## Engineering implications
- Need per-event grouping (event_ticker) to enforce maxEventExposurePct.
- Need a persistent notion of peak equity and equity floor.
- Need liquidity-aware sizing (30% of book depth).
- Need session accounting: realized/unrealized PnL tracking and daily rollovers.
