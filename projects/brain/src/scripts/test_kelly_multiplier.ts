import assert from 'node:assert/strict';

import { getKellyMultiplier } from '../bots/risk/risk_compute';

// Gate 4 regression test: drawdown tier boundaries must be stable.
// If these fail, circuit breaker / sizing safety is likely broken.
const cases: Array<{ d: number; expected: number }> = [
  { d: 0.0, expected: 1.0 },
  { d: 0.05, expected: 1.0 },
  { d: 0.06, expected: 0.6 },
  { d: 0.1, expected: 0.6 },
  { d: 0.11, expected: 0.3 },
  { d: 0.15, expected: 0.3 },
  { d: 0.16, expected: 0.1 },
  { d: 0.2, expected: 0.1 },
  { d: 0.21, expected: 0.0 },
];

for (const c of cases) {
  const got = getKellyMultiplier(c.d);
  assert.equal(got, c.expected, `getKellyMultiplier(${c.d}) expected ${c.expected} got ${got}`);
}

console.log('kelly_multiplier_ok', { cases: cases.length });
