/**
 * BeanBot Setup Scorer (Phase 2 stub)
 *
 * score(entry_prob, entry_quarter, clock_remaining_sec, score_deficit, momentum_3min) -> 0..1
 *
 * v0: hardcoded weights. These will be learned/calibrated from the full historical dataset.
 */

function clamp01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

function norm(x, lo, hi) {
  if (x === null || x === undefined) return 0;
  if (!Number.isFinite(x)) return 0;
  if (hi === lo) return 0;
  return clamp01((x - lo) / (hi - lo));
}

export function score({
  entry_prob,
  entry_quarter,
  clock_remaining_sec,
  score_deficit,
  momentum_3min,
} = {}) {
  // --- Feature transforms (0..1) ---

  // Prefer deeper dips (closer to 0.30) over mild dips (0.50)
  const dip = clamp01(norm(0.50 - entry_prob, 0.00, 0.20)); // 0 at 0.50, 1 at 0.30

  // Earlier quarters generally offer more time for mean reversion
  const q = Number(entry_quarter);
  const quarterScore = (q === 1) ? 1.0 : (q === 2) ? 0.7 : (q === 3) ? 0.4 : 0.0;

  // More time remaining within quarter (heuristic)
  const clock = Number(clock_remaining_sec);
  const clockScore = clamp01(norm(clock, 0, 12 * 60));

  // Moderate deficits might be best; very large deficits may indicate true mismatch.
  // v0: treat deficit 1..20 as good, saturating.
  const def = clamp01(norm(Number(score_deficit), 0, 20));

  // Momentum: positive = recovering; negative = worsening.
  // v0: mild penalty if strongly negative.
  const mom = Number(momentum_3min);
  const momentumScore = Number.isFinite(mom) ? clamp01(0.5 + mom * 5) : 0.5;

  // --- Weighted sum ---
  const w = {
    dip: 0.35,
    quarter: 0.25,
    clock: 0.15,
    deficit: 0.15,
    momentum: 0.10,
  };

  const raw =
    w.dip * dip +
    w.quarter * quarterScore +
    w.clock * clockScore +
    w.deficit * def +
    w.momentum * momentumScore;

  return clamp01(raw);
}

export const DEFAULT_WEIGHTS = {
  dip: 0.35,
  quarter: 0.25,
  clock: 0.15,
  deficit: 0.15,
  momentum: 0.10,
};
