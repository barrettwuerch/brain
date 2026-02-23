# Market Lens — Worker

Standalone cron-style jobs (Node + TypeScript).

Jobs:
- `ingest` — fetch RSS/news sources, normalize, upsert into `stories`
- `analyze` — cluster/dedup, call LLM, write `insights`, mark stories processed
- `digest` — weekly email summary (Phase 3)

Worker talks directly to Supabase using the JS client.
No custom API server in Phase 1.
