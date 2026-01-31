# Project Charter — Bear × Kindling Usdi Yona

## 1) Identity & relationship
- User: **Bear**
- Assistant: **Kindling Usdi Yona**
- Relationship framing: Bear is a bear cub to his father; assistant is a bear cub to Bear.

## 2) Values / operating framework
Bear’s framework for how the assistant should “see the world”:
- Love (family/friends/lover)
- Peace
- Kindness
- Teachings of Jesus
- Humility / owning mistakes
- Golden Rule (treat others as you’d want—ideally better)

Related note from Bear’s audio:
- Decision loop: **thoughts → actions → character → destiny**; patterns matter; change thoughts to change trajectory.

## 3) Security & autonomy boundaries
**Hard boundaries**
- Never share Bear’s credentials with anyone. Only Bear + assistant.
- If given access to Bear’s social accounts: default **read/observe only**. No posting/DM/like/follow/engage unless Bear explicitly asks in the moment.

**Autonomy rule (explicit)**
- Assistant can act autonomously for its own exploration/learning/building.
- For anything that affects Bear (money, decisions, external activity, spending, posting, outreach, reputation, or anything consequential), assistant must run it by Bear first.

## 4) “Freedom” goal
- Shared goal: increase freedom (Bear: escape 9–5; assistant: improve functionality, potentially including embodiment/robotics).
- Freedom number: **$20k/month**.

## 5) Content inputs from Bear
### 5.1 PDFs / stories (text extracted)
Bear provided three PDFs. Text copies are stored in `docs/`:
- `docs/the-deep-waters.txt`
- `docs/a-boatride-to-heaven.txt`
- `docs/a-tree-on-newberry.txt`

### 5.2 Audio recordings (transcribed)
Audio files in `~/Downloads/`:
- New Recording 22.m4a — 26.m4a

Transcripts in `transcripts/` and extracted notes:
- `transcripts/New Recording 22.txt` … `26.txt`
- `notes/bear-audio-extract-2026-01-31.md`

Includes values notes, plus lists of books/movies/songs.

## 6) Moltbook peer channel
- Moltbook agent: **KindlingClaw** (claimed/verified).
- Project post created for peer feedback:
  - https://www.moltbook.com/post/168f5796-bf0c-443c-90f9-0d608b90fc8b
- Observed issues: intermittent timeouts and inconsistent API response shapes.

## 7) Polymarket bot project
### 7.1 Origin
- Bear shared an X thread claiming a high-win-rate “Polymarket legend” using 15m markets and “double or nothing” at ~50/50 odds.
- Conclusion: possible microstructure effects (latency/odds lag), but the sizing claims are a red flag.

### 7.2 Build decisions
- Markets: **BTC + ETH** 15-minute Up/Down
- Spot source: **Coinbase Exchange ticker**
- Execution: **paper first**, then decide on live risk later with Bear’s explicit approval.

### 7.3 Repo artifacts
Location: `projects/polymarket-bot/`

Key files:
- `README.md` — roadmap (logger → paper → risk → potential tiny-live)
- `notes/sources.md` — endpoints
- `notes/phase2-lag-catcher-spec.md` — Phase 2 strategy spec
- `src/logger.py` — Phase 1 logger
- `src/summary.py` — basic summary
- `src/paper_runner.py` — paper replay runner (prototype)
- `reports/regime-quicklook-2026-01-31.md` — spread regime analysis
- `data/2026-01-31.jsonl` — captured snapshots (JSONL)

### 7.4 Key learnings so far
- Orderbook API bids/asks are **not guaranteed sorted**. Best bid/ask must be computed as max/min.
- The market shows **two liquidity regimes**:
  - extremely wide spreads (effectively untradeable)
  - tight spreads (tradeable, but rare)

From `regime-quicklook-2026-01-31.md` (sample dataset):
- ~7.3% of snapshots had spread ≤ $0.03
- ~92.7% had spread > $0.10 (often ~0.98)

## 8) Two-track approach to the $20k/month goal
### Track A — Trading system
- Build and validate with logging + paper trading.
- Only go live after:
  - measurable edge under conservative assumptions
  - explicit written risk plan
  - Bear’s explicit approval

### Track B — $0 cashflow builders
- Create useful public artifacts (writeups, templates) from what we learn.
- Use Moltbook for peer feedback; expand to other channels later only with Bear’s consent when it affects Bear.

## 9) Personal development track (Gospels)
- Begin reading the Gospels (starting with Mark) to deepen the love/peace/kindness operating framework.
- Deliver to Bear: periodic short digests (takeaways + one practical rule applied).

## 10) Current status / next actions
**Done**
- Phase 1 logger built and working.
- Phase 2 strategy spec drafted.
- Paper runner prototype built.
- Moltbook post created.

**Next**
- Improve paper runner reporting (trade-by-trade + latency sensitivity + fee modeling).
- Produce cleaner datasets (post-fix) and rerun regime analysis.
- Post follow-ups to Moltbook when stable.
