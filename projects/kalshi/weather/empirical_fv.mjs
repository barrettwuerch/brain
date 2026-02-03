/**
 * empirical_fv.mjs
 *
 * Empirical CDF FV model for Kalshi daily high-temperature bracket markets.
 *
 * Uses historical observed daily highs (GHCNd TMAX) per station/month.
 *
 * Main export:
 *   computeEmpiricalFVs({ brackets, cityCode, month, forecastHighF, horizonHours, baseRates })
 *
 * baseRates should be:
 * {
 *   sortedValues: { [cityCode]: { [MM]: number[] } },
 *   stats?: { months?: { [cityCode]: { [MM]: { meanF?: number }}}}
 * }
 */

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function clampInt(n, lo, hi) { return Math.max(lo, Math.min(hi, Math.trunc(n))); }

function mean(xs) {
  if (!xs?.length) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function forecastWeightByHorizonHours(h, table) {
  // Piecewise-constant schedule matching sigmaByHorizonHours style.
  // table: [{maxH:number, w:number}]
  if (Array.isArray(table) && table.length) {
    for (const row of table) {
      if (h <= Number(row.maxH)) return clamp(Number(row.w), 0, 1);
    }
    return clamp(Number(table[table.length - 1]?.w ?? 0.6), 0, 1);
  }

  // Fallback heuristic.
  const pts = [
    { h: 0, w: 0.97 },
    { h: 6, w: 0.95 },
    { h: 12, w: 0.90 },
    { h: 24, w: 0.85 },
    { h: 48, w: 0.60 },
    { h: 72, w: 0.40 },
    { h: 96, w: 0.25 },
    { h: 168, w: 0.15 },
  ];
  if (!Number.isFinite(h)) return 0.6;
  if (h <= pts[0].h) return pts[0].w;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (h <= b.h) {
      const t = (h - a.h) / (b.h - a.h);
      return a.w + t * (b.w - a.w);
    }
  }
  return pts[pts.length - 1].w;
}

function countAndProbFromSamples(samples, bracket) {
  const n = samples.length;
  if (!n) return { count: 0, prob: 0 };

  // Use continuous boundaries consistent with integer outcomes.
  // range [lo,hi] inclusive -> [lo-0.5, hi+0.5)
  // gt >lo (integer) -> [lo+0.5, +inf)
  // lt <hi (integer) -> (-inf, hi-0.5)
  let loB = -Infinity;
  let hiB = Infinity;

  if (bracket.kind === 'range') {
    loB = bracket.lo - 0.5;
    hiB = bracket.hi + 0.5;
  } else if (bracket.kind === 'gt') {
    loB = bracket.lo + 0.5;
    hiB = Infinity;
  } else if (bracket.kind === 'lt') {
    loB = -Infinity;
    hiB = bracket.hi - 0.5;
  }

  let k = 0;
  for (const v of samples) {
    if (v >= loB && v < hiB) k++;
  }
  return { count: k, prob: k / n };
}

function normalCdf(x) {
  // Abramowitz-Stegun approximation
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

function bracketProbabilityNormal(mu, sigma, bracket) {
  if (!(Number.isFinite(mu) && Number.isFinite(sigma) && sigma > 0)) return null;

  let loB = -Infinity;
  let hiB = Infinity;

  if (bracket.kind === 'range') {
    loB = bracket.lo - 0.5;
    hiB = bracket.hi + 0.5;
  } else if (bracket.kind === 'gt') {
    loB = bracket.lo + 0.5;
  } else if (bracket.kind === 'lt') {
    hiB = bracket.hi - 0.5;
  }

  const cdf = (x) => {
    if (x === Infinity) return 1;
    if (x === -Infinity) return 0;
    return normalCdf((x - mu) / sigma);
  };

  return clamp(cdf(hiB) - cdf(loB), 0, 1);
}

function allocateCoherentCents(probByTicker) {
  // probByTicker: Map<ticker, prob> where sum may not be 1.
  const raw = [...probByTicker.entries()].map(([ticker, prob]) => ({ ticker, prob: clamp(Number(prob) || 0, 0, 1) }));
  const total = raw.reduce((s, r) => s + r.prob, 0);

  if (!(total > 0) || raw.length === 0) {
    const uniform = raw.length ? 1 / raw.length : 0;
    const out = new Map();
    for (const r of raw) out.set(r.ticker, { prob: uniform, fvCents: clampInt(Math.round(uniform * 100), 1, 99) });
    return out;
  }

  const norm = raw.map(r => ({ ticker: r.ticker, prob: r.prob / total }));

  const cents = norm.map(r => {
    const exact = r.prob * 100;
    let base = Math.floor(exact);
    const frac = exact - base;
    base = clampInt(base, 1, 99);
    return { ticker: r.ticker, prob: r.prob, base, frac };
  });

  let sum = cents.reduce((s, c) => s + c.base, 0);

  if (sum < 100) {
    cents.sort((a, b) => b.frac - a.frac);
    let i = 0;
    while (sum < 100 && cents.length) {
      const c = cents[i % cents.length];
      if (c.base < 99) { c.base += 1; sum += 1; }
      i++;
      if (i > 10000) break;
    }
  } else if (sum > 100) {
    cents.sort((a, b) => a.frac - b.frac);
    let i = 0;
    while (sum > 100 && cents.length) {
      const c = cents[i % cents.length];
      if (c.base > 1) { c.base -= 1; sum -= 1; }
      i++;
      if (i > 10000) break;
    }
  }

  const out = new Map();
  for (const c of cents) out.set(c.ticker, { prob: c.prob, fvCents: clampInt(c.base, 1, 99) });
  return out;
}

export function computeEmpiricalFVs({
  brackets,
  cityCode,
  month,
  forecastHighF,
  horizonHours,
  baseRates,
  horizonWeights,
  gaussianSigmaF, // deprecated (kept for compatibility; not used for smoothing)
  thinTail,
}) {
  const mm = String(month).padStart(2, '0');
  const values = baseRates?.sortedValues?.[cityCode]?.[mm] || [];
  const sampleSize = values.length;

  const climMean =
    (baseRates?.stats?.months?.[cityCode]?.[mm]?.meanF != null)
      ? Number(baseRates.stats.months[cityCode][mm].meanF)
      : mean(values);

  const haveForecast = Number.isFinite(forecastHighF);
  const haveClimo = Number.isFinite(climMean) && sampleSize > 0;

  // Degrade gracefully.
  if (!haveClimo) {
    // Uniform across provided brackets.
    const probByTicker = new Map(brackets.map(b => [b.ticker, 1 / Math.max(1, brackets.length)]));
    const fv = allocateCoherentCents(probByTicker);
    return { model: 'uniform', fvByTicker: fv, meta: { sampleSize, climMeanF: climMean ?? null, forecastHighF: haveForecast ? forecastHighF : null, shiftF: null, forecastWeight: null } };
  }

  const climStd = (baseRates?.stats?.months?.[cityCode]?.[mm]?.stdDevF != null)
    ? Number(baseRates.stats.months[cityCode][mm].stdDevF)
    : null;

  const shiftF = haveForecast ? (forecastHighF - climMean) : 0;
  const w = haveForecast ? forecastWeightByHorizonHours(horizonHours, horizonWeights) : 0;

  // Forecast-shifted samples
  const shifted = haveForecast ? values.map(v => v + shiftF) : values;

  const minSamples = Number(thinTail?.minSamples ?? 0);
  const canGauss = haveForecast && Number.isFinite(climStd) && climStd > 0;

  const probByTicker = new Map();
  const detailByTicker = new Map();
  let smoothedBrackets = 0;

  for (const b of brackets) {
    const shiftedStats = countAndProbFromSamples(shifted, b);
    const climoStats = countAndProbFromSamples(values, b);

    // Empirical probability is a blend of forecast-shifted distribution and raw climatology.
    const pEmp = clamp(w * shiftedStats.prob + (1 - w) * climoStats.prob, 0, 1);

    let pFinal = pEmp;
    let alpha = 1;
    let pGauss = null;

    // Thin-tail smoothing (spec): use shifted effectiveN; blend toward Gaussian using climatological σ.
    const effectiveN = shiftedStats.count;
    if (minSamples > 0 && canGauss && effectiveN < minSamples) {
      pGauss = bracketProbabilityNormal(forecastHighF, climStd, b);
      if (pGauss != null) {
        alpha = clamp(effectiveN / minSamples, 0, 1);
        pFinal = clamp(alpha * pEmp + (1 - alpha) * pGauss, 0, 1);
        smoothedBrackets++;
      }
    }

    probByTicker.set(b.ticker, pFinal);
    detailByTicker.set(b.ticker, {
      effectiveN,
      minSamples: (minSamples > 0) ? minSamples : null,
      alpha,
      pEmp,
      pGauss,
      pFinal,
    });
  }

  const fvByTicker = allocateCoherentCents(probByTicker);

  return {
    model: 'empirical_shifted_cdf',
    fvByTicker,
    detailByTicker,
    meta: {
      sampleSize,
      climMeanF: Number.isFinite(climMean) ? climMean : null,
      climStdDevF: Number.isFinite(climStd) ? climStd : null,
      forecastHighF: haveForecast ? forecastHighF : null,
      shiftF: haveForecast ? shiftF : null,
      forecastWeight: haveForecast ? w : 0,
      thinTailMinSamples: (minSamples > 0) ? minSamples : null,
      smoothedBrackets,
    },
  };
}
