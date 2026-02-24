# Brain — Supabase schema push (no dashboard clicking)

This assumes you have the Supabase CLI installed and logged in.

## 0) Prereqs
- Install CLI:
  ```bash
  brew install supabase/tap/supabase
  ```
- Login:
  ```bash
  supabase login
  ```

## 1) Initialize Supabase project folder
From the repo root:

```bash
cd projects/brain
supabase init --workdir .
```

## 2) Create a Supabase project (CLI)
Supabase CLI currently does not reliably support fully non-interactive project creation for all accounts.
Recommended:
- Create the project once in the Supabase UI **OR** use `supabase projects create` if available in your CLI version.

If your CLI supports it, try:
```bash
supabase projects create brain --org-id <ORG_ID> --region <REGION>
```

Then note the project ref shown (like `xxxxxxxxxxxxxxxxxxxx`).

## 3) Link the local folder to the remote project
```bash
supabase link --project-ref <PROJECT_REF>
```

## 4) Put schema into a migration and push
Create a migration file containing `../schema.sql` contents.

Example:
```bash
mkdir -p supabase/migrations
cp schema.sql supabase/migrations/0001_init.sql
supabase db push
```

## 5) Verify pgvector + ivfflat index exists
Use the remote DB connection (CLI prints connection info with `--debug`).

Option A (preferred): run a verification query in `supabase db push` output using `psql`.

Verification SQL:
```sql
-- pgvector enabled?
select extname from pg_extension where extname in ('vector','pgcrypto');

-- embedding column exists?
select column_name, udt_name
from information_schema.columns
where table_schema='public' and table_name='episodes' and column_name='embedding';

-- ivfflat index exists?
select indexname, indexdef
from pg_indexes
where schemaname='public' and tablename='episodes' and indexname like '%ivfflat%';
```

If you do have `psql` installed and a connection string, run:
```bash
psql "<CONNECTION_STRING>" -c "select extname from pg_extension where extname in ('vector','pgcrypto');"
psql "<CONNECTION_STRING>" -c "select indexname from pg_indexes where schemaname='public' and tablename='episodes' and indexname like '%ivfflat%';"
```

## 6) Notes
- `ivfflat` indexes are most useful once the table has enough rows. For very small datasets, sequential scan is fine.
- For production, tighten RLS (public read is Phase 1 only).
