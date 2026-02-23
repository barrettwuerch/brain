# Market Lens — TODO (initial)

## Phase 0: Decisions (1–2 hours)
- [ ] Pick DB: SQLite (local-first) vs Supabase (hosted)
- [ ] Pick backend shape: simple Node/Express API vs serverless functions
- [ ] Decide LLM provider + key management

## Phase 1: Foundation
### Ingestion
- [ ] Implement RSS fetcher (start with 5-6 sources)
- [ ] Normalize story object: url, title, body/summary, published_at, source, categories
- [ ] Persistence: stories table with unique(url) + hash(content)
- [ ] Scheduler: cron every 4h (and 30m for “breaking” feeds)

### Dedup / clustering
- [ ] Baseline: exact URL + title similarity
- [ ] Semantic: embeddings + cosine similarity (cluster threshold)

### Analysis
- [ ] Write prompts: analyst system prompt + JSON schema output
- [ ] Implement analysis worker: cluster → insight JSON → store

### UI
- [ ] Minimal dashboard: list insight cards (headline, thesis, direction, conviction, horizon)

### Deploy
- [ ] Vercel (frontend) + Railway (backend) or all-in-one

## Phase 2: Intelligence Upgrade
- [ ] Pipeline Radar pass (court/reg/legislative)
- [ ] Sector heatmap aggregation
- [ ] Expand sources: EDGAR, Fed, Federal Register, Reddit, StockTwits

## Phase 3: Delivery & Personalization
- [ ] Weekly digest job + Resend
- [ ] Family profiles + filtering
- [ ] Archive + search

## Phase 4: Tracking
- [ ] Outcome tracking + accuracy scoring
- [ ] Prompt iteration workflow
