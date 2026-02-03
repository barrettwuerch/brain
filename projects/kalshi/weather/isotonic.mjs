/**
 * isotonic.mjs
 *
 * Simple isotonic regression (Pool Adjacent Violators) for calibration.
 * Fits a monotone non-decreasing mapping from x (predicted prob) -> yhat (empirical hit rate).
 */

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export function fitIsotonic({ x, y, w }) {
  if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) {
    throw new Error('fitIsotonic: x and y must be arrays of same length');
  }
  const n = x.length;
  if (n === 0) return [];
  const ww = w && Array.isArray(w) && w.length === n ? w : Array(n).fill(1);

  // Sort by x
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => x[a] - x[b]);

  // Blocks: { xMin, xMax, wSum, ySum, yHat }
  const blocks = [];
  for (const i of idx) {
    const xi = clamp(Number(x[i]) || 0, 0, 1);
    const yi = clamp(Number(y[i]) || 0, 0, 1);
    const wi = Math.max(0, Number(ww[i]) || 0);
    if (wi === 0) continue;

    blocks.push({ xMin: xi, xMax: xi, wSum: wi, ySum: wi * yi, yHat: yi });

    // Merge adjacent violators
    while (blocks.length >= 2) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      const aHat = a.ySum / a.wSum;
      const bHat = b.ySum / b.wSum;
      if (aHat <= bHat) break;
      // merge
      const merged = {
        xMin: a.xMin,
        xMax: b.xMax,
        wSum: a.wSum + b.wSum,
        ySum: a.ySum + b.ySum,
      };
      merged.yHat = merged.ySum / merged.wSum;
      blocks.splice(blocks.length - 2, 2, merged);
    }
  }

  // Finalize yHat + clamp
  for (const b of blocks) b.yHat = clamp(b.ySum / b.wSum, 0, 1);

  return blocks;
}

export function makeIsotonicPredictor(blocks) {
  // Step function: returns yHat for block containing p, using nearest block if outside.
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return (p) => clamp(Number(p) || 0, 0, 1);
  }
  const bs = blocks.slice().sort((a, b) => a.xMin - b.xMin);
  return (p) => {
    const pp = clamp(Number(p) || 0, 0, 1);
    // binary search by xMax
    let lo = 0, hi = bs.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (pp <= bs[mid].xMax) hi = mid;
      else lo = mid + 1;
    }
    const b = bs[lo];
    return clamp(b?.yHat ?? pp, 0, 1);
  };
}
