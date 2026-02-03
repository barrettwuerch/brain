/**
 * calibration.mjs
 */

import { makeIsotonicPredictor } from './isotonic.mjs';

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export function loadCalibrationObject(obj) {
  if (!obj || obj.kind !== 'isotonic' || !Array.isArray(obj.blocks)) return null;
  const predict = makeIsotonicPredictor(obj.blocks);
  return {
    kind: 'isotonic',
    predict: (p) => clamp(predict(p), 0, 1),
    blocks: obj.blocks,
  };
}
