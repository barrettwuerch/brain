export function gameElapsedSec(period, clockSec) {
  const p = Number(period);
  const c = Number(clockSec);
  if (!Number.isFinite(p) || !Number.isFinite(c)) return null;
  const qLen = 12 * 60;
  if (p < 1 || p > 4) return null;
  if (c < 0 || c > qLen) return null;
  return (p - 1) * qLen + (qLen - c);
}

// Minute index that resets at halftime (0..23 each half)
export function minuteIndexHalf(period, clockSec) {
  const el = gameElapsedSec(period, clockSec);
  if (el == null) return null;
  const halfElapsed = (period <= 2) ? el : (el - 24 * 60);
  return Math.max(0, Math.floor(halfElapsed / 60));
}
