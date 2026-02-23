# Repo structure (Phase 1)

Decision: worker + frontend first; no custom API layer.

```
projects/marketlens/
├── worker/           # Node/TS ingestion + analysis + digest jobs
│   └── src/
├── web/              # React dashboard
│   └── src/
├── shared/           # shared TS types only
│   └── types.ts
└── supabase/         # schema + migrations
    └── migrations/
```

Rationale:
- Supabase provides Postgres + REST + realtime
- Frontend reads from Supabase directly
- Worker writes to Supabase directly
- Add API layer later only if needed for secrets, rate limiting, complex server-side logic
