# v0.85 Checklist (Kalshi bot)

**Purpose:** make the “go/no-go for v0.85” criteria explicit and repeatable.

**Current estimate:** v0.80 (infrastructure shipped; outcomes not yet validated)

---

## Gate 1 — First scored resolution (BORD)
**Target market:** `KXTRUMPMENTION-26FEB04-BORD`

### Steps
- [ ] Confirm market status/settlement via Kalshi API (resolved YES/NO)
- [ ] Score using `score_market.mjs` and append to calibration log:
  ```bash
  node projects/kalshi/scripts/score_market.mjs \
    --log projects/kalshi/logs/YYYY-MM-DD.jsonl \
    --market KXTRUMPMENTION-26FEB04-BORD \
    --append projects/kalshi/calibration_log.jsonl
  ```
  **Note:** `--log` must point to the day the bot was quoting BORD (may differ from resolution day).
- [ ] Record the bot’s predicted FV and outcome:
  - predictedFvCents: ___
  - outcome: YES/NO
  - deltaCents = outcomeCents - predictedFvCents: ___

### Pass criteria (v0.85 gate)
- [ ] Absolute error `|deltaCents| <= 15` (first datapoint sanity)
- [ ] Event type classification logged as expected (TRUMP_SPEECH vs WHITE_HOUSE)

---

## Gate 2 — One clean overnight paper run
### Steps
- [ ] Run paper bot overnight (or for >= 6 hours continuous)
- [ ] Confirm no crash loop / no repeated fatal errors
- [ ] Confirm selection refresh still works (no silent stale list)
- [ ] Confirm position caps prevent runaway inventory

### Morning checks
- [ ] Run MTM report:
  ```bash
  node projects/kalshi/report.mjs --log projects/kalshi/logs/YYYY-MM-DD.jsonl
  ```
- [ ] Spot-check first TRUMP_SPEECH orders in JSONL:
  - [ ] `eventType: TRUMP_SPEECH`
  - [ ] FV roughly matches manual TRUMP_SPEECH rates (e.g., border ~50, tariffs ~55)
  - [ ] `fvMode` expected (`base_rate` for known keywords)

### Pass criteria
- [ ] No crashes / halts
- [ ] Unrealized MTM not pathological (no single-market blowups; small drawdown acceptable)
- [ ] No evidence of misclassification (TRUMP markets treated as TRUMP_SPEECH)

---

## Gate 3 — News baseline stability (>= 48 hours)
### Steps
- [ ] Ensure baseline logger runs every 6 hours (launchd)
- [ ] After >=48h, inspect `rss_baseline.jsonl`:
  - [ ] 1h window shows real variance across keywords (not all capped at 100)
  - [ ] Baselines exist for most keywords and do not rely on fallback `newsBaselineCount`

### Pass criteria
- [ ] 1h baselines appear stable and keyword-specific
- [ ] No systematic saturation except for a few very common terms (expected)

---

## Definition of v0.85
We advance to **v0.85** when:
- Gate 1 passes (BORD scored, reasonable error)
- Gate 2 passes (one clean overnight run)
- Gate 3 is at least “in progress” with >=48h of baseline data and non-saturated 1h counts

---

## Calibration log location
- `projects/kalshi/calibration_log.jsonl`

Each line should be the one-line JSON output from `score_market.mjs`.
