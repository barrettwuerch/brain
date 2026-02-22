// Event ticker format (confirmed):
// KXNBAGAME-{YY}{MON}{DD}{AWAYTEAM}{HOMETEAM}
// Example: KXNBAGAME-26FEB22BKNATL

const MONS = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

export function parseNbaEventTicker(eventTicker) {
  const m = String(eventTicker || '').match(/^KXNBAGAME-(\d{2})([A-Z]{3})(\d{2})([A-Z]{3})([A-Z]{3})$/);
  if (!m) return { ok: false, reason: 'bad_format', eventTicker };
  const [, yy, mon, dd, away, home] = m;
  const month = MONS[mon];
  if (!month) return { ok: false, reason: 'bad_month', eventTicker, mon };
  const year = 2000 + Number(yy);
  const day = Number(dd);
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { ok: true, eventTicker, date, year, month, day, away, home };
}
