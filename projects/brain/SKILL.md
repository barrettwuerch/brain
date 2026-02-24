# BRAIN — Skill File

## Read this before touching anything in `projects/brain/`

## What This Project Is
You are building a **learning agent brain** — not a task-specific bot, not a pipeline.

The brain has three core capabilities that must be preserved in every change you make:
1. **Memory** — it remembers what happened, why it failed, and what worked, across every run
2. **Reasoning Quality** — it knows if it's getting smarter vs. getting lucky
3. **Generalization** — it applies what it learned on Task A to Task B without starting over

Everything in this codebase exists to serve those three things. If a change doesn't serve at least one of them, question it.

---

## The Core Loop
Every run the brain makes follows exactly five steps. Never collapse, skip, or reorder them:

```
REASON → ACT → OBSERVE → REFLECT → STORE
```

| Step | What It Does | Returns |
|------|-------------|---------|
| `reason()` | Reads task + memory context, thinks out loud (ReAct-style), proposes an action | `ReasonOutput` |
| `act()` | Executes the proposed action against real data | `ActOutput` |
| `observe()` | Compares result to ground truth, classifies outcome and error type | `ObserveOutput` |
| `reflect()` | Self-evaluates reasoning quality honestly, extracts lessons | `ReflectOutput` |
| `store()` | Writes complete episode to Supabase with embedding | `Episode` |

The loop lives in: `projects/brain/src/agent/loop.ts`

---

## Memory Architecture — Three Layers

### Layer 1: Episodic (what happened)
- Every run writes one episode row to `episodes` table
- Includes full chain-of-thought, action, observation, reflection, outcome scores
- Includes a 1536-dim embedding of `chain_of_thought + reflection` for semantic retrieval
- TTL rules: correct → 30 days, incorrect → 60 days, high-importance (>0.9) → 90 days

### Layer 2: Semantic (what the agent has learned)
- Distilled facts extracted from episode clusters by the nightly consolidation job
- Each fact has `confidence`, `times_confirmed`, `times_violated`
- Retire a fact if `times_violated / times_confirmed > 0.4`
- No duplicate facts — check cosine similarity > 0.85 before inserting

### Layer 3: Procedural (how to approach task types)
- One procedure per task type — ordered steps, cautions, success/failure patterns
- Injected into the REASON step prompt when the task type matches
- Updated after every 20 episodes of the same task type

**Memory context is injected into the MEMORY CONTEXT slot in `reason()` — that slot must always exist, even when empty.**

---

## Architecture Conventions — Never Break These

### Database
- **All reads** → `supabase` client (anon key) from `src/lib/supabase.ts`
- **All writes** → `supabaseAdmin` client (service role key) from `src/lib/supabase.ts`
- Never instantiate a Supabase client anywhere else — always import from `src/lib/supabase.ts`

### Embeddings
- Always use `embed()` from `src/lib/embeddings.ts`
- Model: `text-embedding-3-small`, 1536 dimensions
- Embed the concatenation of `chain_of_thought + " " + reflection`
- Never embed raw task input — embed the reasoning, not the data

### Claude API
- Use `src/lib/anthropic.ts` for all Claude calls
- Model: `claude-sonnet-4-6`
- Always parse structured JSON from Claude responses — never trust raw text
- The `reason()` prompt always has three sections: MEMORY CONTEXT, TASK, INSTRUCTIONS
- The `reflect()` prompt always receives: task, chain_of_thought, action_taken, observation, ground_truth

### TypeScript
- All core types live in `src/types.ts` — add new types there, never inline
- `noEmit: true` in tsconfig — never commit generated `.js` files
- Run via `tsx`, not compiled JS

### Secrets
- Never commit `.env` — it is gitignored
- Never log API keys, even partially
- Never paste secrets into chat

---

## File Map

```
projects/brain/
├── schema.sql
├── .env.example
├── .env
├── package.json
├── tsconfig.json
├── src/
│   ├── types.ts
│   ├── agent/
│   │   ├── loop.ts
│   │   └── level1_compute.ts
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── embeddings.ts
│   │   └── anthropic.ts
│   ├── memory/
│   │   ├── episodic.ts
│   │   ├── semantic.ts
│   │   └── procedural.ts
│   └── tasks/
│       └── level1.ts
├── scripts/
│   └── schema_push.md
└── examples/
    └── episode_example.json
```

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `tasks` | Work queue — seeded by task generators, consumed by the loop |
| `episodes` | Every run ever made — includes embedding vector |
| `semantic_facts` | Distilled patterns with confidence scores |
| `procedures` | Learned behavioral playbooks per task type |
| `intelligence_scores` | Weekly performance metrics per task type |

Schema lives in `schema.sql`. If you need to add a column, update `schema.sql` first, then the corresponding TypeScript interface in `types.ts`.

---

## Build Phase Status

### ✅ Phase 1 — Foundation
Schema live in Supabase, TypeScript types defined, all stubs created, env template ready, reference episode example written.

### ✅ Phase 2 — Loop Turns
`reason()` implemented with ReAct-style prompt and structured JSON output.
`act()` implemented for Level 1 CPI tasks.

### 🔄 Phase 3 — Memory Writes
Blocked on LLM/embeddings credentials/credits. Once available:
- observe/reflect/store run end-to-end
- `dev:run-loop` accumulates episodes

### ⬜ Phase 4 — Memory Retrieval
Implement memory injection into `reason()`.

---

## What NOT to Do
- Do not add task-specific logic to the core loop — `loop.ts` must be task-agnostic
- Do not skip reflection to save API calls — reflection is the learning mechanism
- Do not store everything — memory hygiene matters, apply TTL rules
- Do not collapse episodic + semantic into one table
- Do not use `supabase` (anon) for writes — always use `supabaseAdmin`
- Do not generate `.js` files — use `tsx`
- Do not change loop order
