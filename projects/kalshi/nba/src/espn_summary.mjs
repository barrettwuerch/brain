import { nowMs } from './util.mjs';

export async function fetchEspnNbaSummary({ eventId }) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${encodeURIComponent(eventId)}`;
  const t0 = nowMs();
  const res = await fetch(url, {
    headers: {
      'user-agent': 'OpenClaw-Kalshi-NBA-Bot/0.1',
      'accept': 'application/json,text/plain,*/*',
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok || !data) {
    const err = new Error(`ESPN summary HTTP ${res.status}`);
    err.status = res.status;
    err.body = text.slice(0, 500);
    throw err;
  }
  return { fetchedAtMs: t0, eventId, data };
}

function parseClock(clockDisplay) {
  if (clockDisplay === null || clockDisplay === undefined) return null;
  const s = String(clockDisplay).trim();
  if (!s) return null;
  const m = s.match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function periodElapsedSec(period, clockSec, periodLenSec = 12 * 60) {
  // period is 1-based. clockSec = seconds remaining.
  if (!Number.isFinite(period) || !Number.isFinite(clockSec)) return null;
  const elapsedInPeriod = periodLenSec - clockSec;
  return (period - 1) * periodLenSec + elapsedInPeriod;
}

/**
 * Build a per-minute score timeline from ESPN plays.
 * Output: Map<minuteIndex, { homeScore, awayScore, period, clockSec }>
 * minuteIndex counts minutes since tip (0 = [0:00,0:59]).
 */
export function buildMinuteScoresFromSummary(summaryData) {
  const plays = summaryData?.data?.plays || summaryData?.plays || [];
  const out = new Map();

  for (const p of plays) {
    const period = Number(p?.period?.number ?? p?.period ?? p?.periodNumber);
    const clockSec = parseClock(p?.clock?.displayValue ?? p?.clock?.displayValue ?? p?.clock);
    const homeScore = Number(p?.homeScore ?? p?.score?.home ?? p?.scoreValueHome);
    const awayScore = Number(p?.awayScore ?? p?.score?.away ?? p?.scoreValueAway);

    if (!Number.isFinite(period) || !Number.isFinite(clockSec)) continue;
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

    const elapsed = periodElapsedSec(period, clockSec);
    if (elapsed == null) continue;

    const minuteIndex = Math.floor(elapsed / 60);
    // Keep the latest play we saw for that minuteIndex (plays are usually chronological).
    out.set(minuteIndex, { homeScore, awayScore, period, clockSec });
  }

  return out;
}
