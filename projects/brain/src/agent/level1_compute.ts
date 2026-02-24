// Shared Level-1 dataset parsing + computations (CPI)

export type CpiRow = { date: string; value: number };

export function parseCpi(csv: string): CpiRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift();
  if (!header) throw new Error('missing header');

  const out: CpiRow[] = [];
  for (const line of lines) {
    const [date, val] = line.split(',');
    if (!date || !val) continue;
    const v = Number(val);
    if (!Number.isFinite(v)) continue;
    out.push({ date, value: v });
  }
  return out;
}

export function maxRow(rows: CpiRow[]) {
  return rows.reduce((best, r) => (r.value > best.value ? r : best), rows[0]);
}

export function maxMoM(rows: CpiRow[]) {
  let best = { date: rows[1].date, delta: rows[1].value - rows[0].value };
  for (let i = 1; i < rows.length; i++) {
    const delta = rows[i].value - rows[i - 1].value;
    if (delta > best.delta) best = { date: rows[i].date, delta };
  }
  return best;
}

export function trendLastN(rows: CpiRow[], n: number): 'up' | 'down' | 'flat' {
  const slice = rows.slice(-n);
  const first = slice[0].value;
  const last = slice[slice.length - 1].value;
  const diff = last - first;
  const eps = 1e-9;
  if (diff > eps) return 'up';
  if (diff < -eps) return 'down';
  return 'flat';
}

function isNumber(x: any): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isPlainObject(x: any): x is Record<string, any> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function deepFuzzyEqual(expected: any, actual: any, eps = 0.001): boolean {
  // Numbers: fuzzy compare
  if (isNumber(expected) && isNumber(actual)) return Math.abs(expected - actual) < eps;

  // Strings/booleans/null: strict
  if (expected === null || actual === null) return expected === actual;
  if (typeof expected !== 'object' || typeof actual !== 'object') return expected === actual;

  // Arrays: same length + elementwise
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return false;
    if (expected.length !== actual.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (!deepFuzzyEqual(expected[i], actual[i], eps)) return false;
    }
    return true;
  }

  // Objects: same keys + recursive compare
  if (isPlainObject(expected) && isPlainObject(actual)) {
    const ek = Object.keys(expected).sort();
    const ak = Object.keys(actual).sort();
    if (ek.length !== ak.length) return false;
    for (let i = 0; i < ek.length; i++) {
      if (ek[i] !== ak[i]) return false;
      const k = ek[i];
      if (!deepFuzzyEqual(expected[k], actual[k], eps)) return false;
    }
    return true;
  }

  // Fallback: strict
  return expected === actual;
}

export function grade(expected: any, actual: any): number {
  // Phase 2+: fuzzy numeric matching to avoid float false negatives.
  return deepFuzzyEqual(expected, actual) ? 1 : 0;
}
