# Walk-forward / OOS parameter tuner (next 90-min sprint)

## Deliverable (definition of done)
- New module: `src/tuner.py` that runs **walk-forward tuning** on `logger.py` JSONL using the existing `paper_runner.run()`.
- Produces:
  - `reports/tuner-<date>-<asset>.md` (human report)
  - `reports/tuner-<date>-<asset>.json` (machine-readable)
- Enforces **out-of-sample** selection:
  - pick best params on TRAIN only
  - evaluate once on the next TEST window(s)
- Split is by **15m Polymarket window slug** (no mixing slugs between train/test).

Non-goal for this sprint: smarter search (Bayes opt), fee curve modeling, live trading.

---

## Overfitting avoidance (must-follow)
1. **Time-ordered folds only** (no shuffling).
2. **Fold unit = slug** (Polymarket 15m instrument rollover). A slug may appear in *train* or *test* but never both.
3. **Boundary leakage control**: within each slug, ignore boundary seconds:
   - `warmup_s = max(horizon_s, warmup_floor_s)` (default floor 60s)
   - `cooldown_s = hold_s + buffer_s + 5`
   This removes the highest-risk overlap region without needing per-fold timestamp embargo logic.
4. **Small grid** (≤ ~250 configs/asset by default).
5. **Stability reporting**: selection frequency across folds (if the “best” params vary wildly, assume overfit).

---

## Split spec: 15m windows
### How to build windows
- Iterate JSONL in order; for each `snapshot` record, for each requested `asset`:
  - read `slug = rec['assets'][asset]['slug']`
  - bucket snapshot into that slug
- Keep slugs in first-seen order (assumes file order is chronological).

### Walk-forward fold definition
For fold index `i`:
- `train_slugs = slugs[i-train_windows : i]`
- `test_slugs  = slugs[i : i+test_windows]`
- Advance by `step` (default 1)

Default recommendations:
- `train_windows=24` (6 hours)
- `test_windows=1` (next 15m)
- `step=1`

Do BTC and ETH separately (simpler, avoids alignment problems).

---

## Parameter grid (tight, implementable)
`paper_runner.run()` params today:
- `spread_max, horizon_s, ret_threshold, hold_s, stop_spread, min_depth,
  fee_bps, size, buffer_s, max_skew_ms, max_book_age_ms`

### Fix (constants for sprint)
- `size=10.0`
- `fee_bps=0.0` (until fee curve is implemented)
- `buffer_s=10`
- `stop_spread=0.10`
- `max_skew_ms=1500`
- `max_book_age_ms=5000`

### Sweep (default grid)
- `horizon_s`: [20, 40, 60]
- `ret_threshold`:
  - BTC: [0.0006, 0.0008, 0.0010]
  - ETH: [0.0008, 0.0012, 0.0016]
- `hold_s`: [20, 40, 60]
- `spread_max`: [0.02, 0.03, 0.04]
- `min_depth`: [0, 5, 10]

Grid size: 3×3×3×3×3 = 243 configs/asset.

---

## Selection / scoring
### Training hard-filters
Reject a config on TRAIN if:
- `net.n < min_trades_train` (default: 5)

### Training score (single scalar)
Use a simple, conservative score to avoid “one lucky trade”:

`score = net.mean * sqrt(net.n)`

Penalties (TRAIN):
- if `exit_missing_book > 0`: `score -= 1000`
- if `rollover_cross > 0`: `score -= 1000`

Pick the config with max score on TRAIN.

### OOS evaluation
Run exactly once on TEST for the chosen config; record:
- `test_net.sum`, `test_net.mean`, `test_net.win_rate`, `test_net.n`
- integrity counters (`rollover_cross`, `exit_missing_book`, rejects)

---

## Minimal implementation plan (no refactor risk)
### Approach: temp filtered JSONL per fold (keep `paper_runner.py` unchanged)
For each fold and asset:
1. Create `tmp/tuner/<run_id>/train-<asset>-foldNN.jsonl` containing only:
   - `type == 'snapshot'`
   - asset exists
   - asset slug in `train_slugs`
   - snapshot not in boundary seconds (warmup/cooldown)
2. Same for TEST.
3. For each config in grid:
   - call `paper_runner.run(train_path, **params)`
   - compute `train_score`
4. Select best config; then call `paper_runner.run(test_path, **best_params)`.

Implementation notes:
- Boundary filtering needs per-record `remaining_s` (already in logger output) and per-slug elapsed time.
  - Minimal way: rely on `remaining_s` only:
    - warmup: skip records where `remaining_s > (900 - warmup_s)`
    - cooldown: skip where `remaining_s < cooldown_s`
  This avoids needing slug start timestamps.

---

## `src/tuner.py` proposed CLI
Example:
```bash
python3 src/tuner.py data/2026-01-31.jsonl \
  --asset BTC \
  --train-windows 24 \
  --test-windows 1 \
  --step 1 \
  --min-trades-train 5 \
  --warmup-floor-s 60 \
  --out-md reports/tuner-2026-01-31-BTC.md \
  --out-json reports/tuner-2026-01-31-BTC.json
```

Suggested flags (tight set):
- positional: `path` (input JSONL)
- `--asset {BTC,ETH}` (required)
- `--train-windows N` (default 24)
- `--test-windows M` (default 1)
- `--step S` (default 1)
- `--min-trades-train K` (default 5)
- `--warmup-floor-s SECONDS` (default 60)
- `--out-md PATH` (optional; default `reports/tuner-<date>-<asset>.md`)
- `--out-json PATH` (optional; default `reports/tuner-<date>-<asset>.json`)
- `--tmp-dir PATH` (default `tmp/tuner`)

Optional (nice-to-have but still simple):
- `--grid preset_name` where `preset_name in {default, fast}`
  - `fast` could be 2×2×2×2×2 = 32 configs for quick smoke tests.

---

## Report outputs
### Markdown (`reports/tuner-*.md`)
Must include:
- run metadata (input path, asset, fold settings, grid size, scoring)
- aggregate OOS stats across folds
- parameter selection frequency across folds
- fold-by-fold table with:
  - fold index
  - train slug range (first/last slug)
  - test slug range
  - selected params
  - train score and train net stats
  - test net stats
  - integrity notes (rollover_cross / exit_missing_book)

Minimum table columns:
- `fold, train_slug_first, train_slug_last, test_slug_first, test_slug_last, best_params, train_score, test_net_sum, test_net_mean, test_trades, notes`

### JSON (`reports/tuner-*.json`)
Top-level shape:
```json
{
  "meta": {"path": "...", "asset": "BTC", "train_windows": 24, "test_windows": 1, "step": 1, "grid_size": 243},
  "grid": [{"spread_max":0.03,"horizon_s":40,...}],
  "folds": [
    {
      "fold": 7,
      "train_slugs": ["..."],
      "test_slugs": ["..."],
      "best_params": {"spread_max":0.03,"horizon_s":40,...},
      "train": {"score": 0.12, "net": {"n": 10, "sum": 0.5, "mean": 0.05, "win_rate": 0.6}, "integrity": {"rollover_cross":0,"exit_missing_book":0}},
      "test":  {"net": {"n": 2, "sum": -0.1, "mean": -0.05, "win_rate": 0.0}, "integrity": {"rollover_cross":0,"exit_missing_book":0}}
    }
  ],
  "selection_frequency": {"horizon_s": {"20": 3, "40": 9}, "spread_max": {"0.03": 8}},
  "oos_aggregate": {"net_sum": 1.42, "net_mean": 0.012, "trades": 118, "win_rate": 0.54}
}
```

---

## Invariants to add to `notes/DECISIONS.md`
Add these as explicit non-negotiables:
1. **All tuning must be walk-forward** (no random CV) and **time-ordered**.
2. **Fold unit is slug**: no slug may be split across train/test.
3. **Selection is train-only**: test window(s) are never used for parameter choice.
4. **Boundary seconds are excluded** (warmup/cooldown) to reduce leakage from horizon/hold overlap.
5. **Integrity failures are disqualifying/penalized**:
   - `rollover_cross` and `exit_missing_book` must be 0 (or heavily penalized) in TRAIN.

---

## Recommended file structure
- `src/tuner.py` (new)
- `reports/` (existing)
  - `tuner-YYYY-MM-DD-BTC.md`
  - `tuner-YYYY-MM-DD-BTC.json`
- `tmp/tuner/` (gitignored)
  - per-run fold train/test JSONL files
