# Stack decisions (Market Lens)

## Database
**Decision:** Supabase (Postgres) for hosted, multi-user family dashboard.

Rationale:
- Multi-device access and concurrent reads are expected
- Supabase free tier capacity is sufficient
- Built-in REST API reduces need for custom backend early

Schema:
- `docs/DB_SCHEMA_SUPABASE.sql`

## Ingestion worker language
Not decided yet.

Recommendation:
- Prefer **Node/TypeScript** for lowest friction with:
  - existing JS ecosystem RSS parsing
  - sharing types/schema with frontend
  - Supabase JS client

Alternative:
- Python if we want heavier NLP tooling + quick scripting.
