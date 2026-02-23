# Market Lens — PRD v1.0

Prepared: February 2026  
Confidential — Family Use

## 1. Overview
Market Lens is a personal investment intelligence dashboard that ingests news from across the web, applies AI reasoning to identify investment implications, and surfaces clear, actionable insights to help family members make more informed financial decisions.

The product is inspired by the idea that sophisticated investors — hedge funds, professional analysts — have teams monitoring regulatory pipelines, earnings, geopolitical events, and market-moving news. Market Lens democratizes that kind of analysis for a non-professional audience.

The catalyst for this concept was the 2025-2026 IEEPA tariff saga: lower courts signaled the tariffs were unconstitutional months before the Supreme Court ruled in February 2026, yet most retail investors were not tracking the legal pipeline. A tool monitoring that signal could have surfaced high-confidence investment ideas well ahead of the market-moving ruling.

### 1.1 Problem Statement
Retail investors are bombarded with financial news but lack the tools to connect events to portfolio implications in real time. Most news apps summarize headlines — they do not perform the second-order reasoning that turns a court ruling, a regulatory change, or a macro shift into a concrete investment thesis with a conviction level and time horizon.

### 1.2 Vision
A dashboard that feels like having a brilliant analyst friend — one who reads everything, connects the dots across domains, and tells you plainly:

> “Here is what happened this week, here is what it means for your money, and here is how confident I am.”

## 2. Goals & Success Criteria
### 2.1 Primary Goals
- **G1** Surface investment-relevant signals from news before they are fully priced into the market.
- **G2** Translate complex regulatory, legal, and macro events into plain-language portfolio implications.
- **G3** Provide conviction levels and time horizons so users know how actionable each insight is.
- **G4** Make the dashboard simple enough for family members with varying investment experience.

### 2.2 Success Criteria
(Needs to be defined: adoption, engagement, quality/accuracy metrics, digest open rate, etc.)

## 3. Users & Personas
Market Lens is built for family members with a range of investment experience and engagement levels.

- **The Active Investor**
- **The Passive Investor**
- **The Curious Learner**

## 4. Features & Requirements

### 4.1 News Ingestion Engine
**Description:** backend system that continuously pulls news from free sources, deduplicates stories, and feeds them into the AI analysis pipeline.

**Sources (Free Tier)**
- Financial: Yahoo Finance RSS, MarketWatch RSS, Reuters RSS, Bloomberg (free articles), AP Business
- Legal/Regulatory: SCOTUSblog RSS, SEC EDGAR filings feed, Federal Register RSS, Congress.gov updates
- Macro/Policy: Federal Reserve press releases, White House briefings, Congressional Budget Office
- Sentiment: Reddit (r/investing, r/stocks via Pushshift or API), StockTwits public feed

**Requirements**
- Poll all sources at minimum every 4 hours; breaking news sources every 30 minutes
- Deduplicate stories using semantic similarity — one core event should produce one insight, not ten
- Tag each story with: source, timestamp, category (legal/earnings/macro/geopolitical/sector), and affected tickers or sectors if identifiable
- Store raw stories and generated insights in a lightweight database (SQLite or Supabase free tier)

### 4.2 AI Analysis Pipeline
**Description:** the core intelligence layer. Takes clustered news events and runs them through Claude API to generate structured investment insight objects.

**Prompt Strategy**
- System prompt establishes role:
  - “You are a senior investment analyst with deep knowledge of financial markets, law, and macroeconomics. Your job is to read news and identify actionable investment implications that a sophisticated retail investor might miss.”
- Each analysis call receives:
  - the raw news cluster
  - any related prior stories for context
  - explicit instructions to reason about second-order effects before first-order conclusions
- Output is structured JSON matching the insight schema — parseable and storable
- Separate pass for “pipeline news”: stories that are not yet market-moving but signal a high-probability future event (court cases, regulatory comment periods, legislative markups)

### 4.3 Dashboard UI
**Description:** React web app presenting insights in a clean, scannable layout organized by conviction level and recency.

**Layout Sections**
- Top Banner: Market mood summary for the day — one sentence, AI-generated
- High Conviction (4-5): prominently featured cards, full insight detail, visual direction indicator
- Watch List (2-3): developing stories worth monitoring, less detail
- Pipeline Radar: legal/regulatory events in-progress with probability and timeline estimates
- Sector Heatmap: visual grid showing which sectors are most affected by this week’s news
- Archive: searchable history of past insights with outcome tracking (did the thesis play out?)

**Insight Card Design**
- Headline + direction badge (bullish/bearish/mixed) with color coding
- One-line thesis — plain English, no jargon
- Expandable detail: full thesis, sectors, tickers, second-order effects, risks
- “Why does this matter?” toggle for educational context (for Curious Learner persona)
- Conviction meter (1-5 stars) and time horizon pill
- Source attribution links

### 4.4 Weekly Digest Email
**Description:** automated weekly email summarizing the top 3-5 insights from the week. Designed for Passive Investor persona who won’t visit the dashboard daily.

**Requirements**
- Sent every Sunday evening
- Plain-English subject line
- Top insights with thesis in 2-3 sentences each
- Link to full dashboard
- Generated by Claude with a “newsletter editor” prompt — punchy, clear, no financial jargon

### 4.5 Family Profiles (Phase 2)
**Description:** optional user profiles for personalization.

**Profile Fields**
- Risk appetite: Conservative / Moderate / Aggressive
- Time horizon: Short-term trader / Long-term investor
- Sectors of interest or existing holdings (manually entered or connected to a brokerage later)
- Experience level: determines whether educational context is shown by default

## 5. Technical Architecture
### 5.1 Stack
(To be finalized; PRD suggests React + Vercel + Railway + Supabase or SQLite.)

### 5.2 Data Flow
- Cron job fires every 4 hours, triggering ingestion worker
- Worker fetches RSS feeds and API sources, deduplicates against DB
- New stories are clustered by semantic topic and stored
- Clusters sent to LLM with analysis prompt; response parsed into insight JSON
- Insights stored in DB; dashboard fetches via API on load
- Sunday digest job queries top insights of the week, generates email via LLM, sends via Resend

### 5.3 Cost Estimate (Monthly)
(TBD)

## 6. Build Plan

### Phase 1 — Foundation (Week 1-2)
Goal: working ingestion pipeline with AI analysis outputting structured insights to a simple UI.
- Set up project repo, DB schema (stories, insights tables), and environment
- Build ingestion worker: 5-6 core RSS sources (Yahoo Finance, Reuters, SCOTUSblog, MarketWatch, AP)
- Write prompt and test insight JSON output — iterate until quality is consistently high
- Minimal React dashboard: list of insight cards, direction badge, conviction level, thesis
- Deploy frontend to Vercel, backend to Railway — share link with family for early feedback

### Phase 2 — Intelligence Upgrade (Week 3-4)
Goal: add second-order reasoning, pipeline radar, and sector heatmap.
- Expand sources to 10+ including SEC EDGAR, Federal Reserve, Reddit sentiment
- Add semantic deduplication / clustering before analysis
- Add “Pipeline Radar” section (slow-moving high-signal stories)
- Build sector heatmap component
- Refine insight cards (expandable details, risk factors, educational context toggle)

### Phase 3 — Delivery & Personalization (Week 5-6)
Goal: weekly digest email live + basic family profiles.
- Sunday digest job: query top insights, generate email, send via Resend
- Family profile system fields; filter/rank dashboard by active profile
- Archive view with search

### Phase 4 — Tracking & Refinement (Ongoing)
Goal: close feedback loop.
- Outcome tracking: manually tag whether high-conviction insight paid off
- Accuracy score: how often were high-conviction calls directionally correct?
- Tune prompts based on misses
- Consider portfolio import (CSV) for personalization

## 7. Open Questions & Decisions
(TBD)

## 8. Out of Scope (V1)
- Brokerage integrations or live portfolio syncing
- Real-time price data or charting
- Automated trading or order execution — analysis only
- Social features, sharing outside family
- Mobile native app
- Any paid data sources or premium API subscriptions
