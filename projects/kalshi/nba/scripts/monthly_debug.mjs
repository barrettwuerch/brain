// scripts/monthly_debug.mjs
import fs from 'fs';

const raw = fs.readFileSync('data_full/backtest_trades.jsonl', 'utf8').trim();
const lines = raw.split('\n').filter((l) => l.trim());
console.log('Total lines:', lines.length);

const trades = lines
  .map((l, i) => {
    try {
      return JSON.parse(l);
    } catch (e) {
      console.log('Parse error line', i, e.message);
      return null;
    }
  })
  .filter(Boolean);

console.log('Total parsed trades:', trades.length);

// Show all unique fields on first trade
console.log('First trade keys:', Object.keys(trades[0]));
console.log('First trade:', JSON.stringify(trades[0], null, 2));

// Show what date field looks like across trades
const dateFields = ['game_date', 'date', 'entry_date', 'timestamp', 'entry_ts'];
for (const field of dateFields) {
  const sample = trades
    .slice(0, 3)
    .map((t) => t[field])
    .filter(Boolean);
  if (sample.length) console.log(`Field "${field}" sample:`, sample);
}
