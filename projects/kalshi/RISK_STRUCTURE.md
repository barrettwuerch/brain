# OpenClaw Risk Structure & Starting Capital Analysis (Aggressive Scaling)

> Authored by Bear. Captured from chat on 2026-02-03.
> This document is authoritative for risk philosophy and parameters.

## Philosophy
Protect the downside absolutely, let the upside run.
- High capital utilization from day one
- Scale position sizes proportionally with account balance
- Growth bottleneck is *market coverage and fill rate*, not “waiting to scale”

## Starting capital
- Target starting balance: **$1,000**

## Capital deployment
- No idle risk buffer by rule
- Target utilization: **50–70%** (naturally limited by unfilled orders)

## Percentage-based limits (auto-scaling)
- Per-market risk cap: **10% of account**
- Per-event exposure cap: **25% of account**
- Daily loss limit: **5% of account** (realized + unrealized)
- Max drawdown halt: **15% from peak equity**
- Profit lock floor: **85% of peak equity** (equity floor ratchets up)

## Size caps / liquidity caps
Effective sizing is the minimum of:
- account-based max
- **30% of opposite-book depth** (avoid being too large vs the book)
- absolute cap per side (launch hard ceiling)

## Launch parameter table (for $1,000)
- maxMarkets: 8 (scales upward with performance)
- minSpreadCents: 3; maxSpreadCents: 50
- maxRiskPerMarketPct: 10%
- maxEventExposurePct: 25%
- dailyLossLimitPct: 5% ($50 at $1k)
- maxDrawdownPct: 15% ($150 at $1k)
- profitLockPct: 85%
- absoluteCapPerSide: 25 contracts (launch)
- staleThresholdCents: 4
- repriceThresholdCents: 2
- maxOrderAgeSeconds: 90
- maxErrorStreak: 5

## Adverse selection budget
- Target adverse selection cost: **< 30% of gross spread captured**
- If a market exceeds the budget over a 10-session window: remove/blacklist for the session.

## Auto-scaling
Recompute all percentage-based limits at each session open using current account balance and peak equity.

## Notes
This doc supersedes prior conservative risk docs.
