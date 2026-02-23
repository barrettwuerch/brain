// scripts/monthly_summary.mjs
import fs from 'fs';

const trades = fs
  .readFileSync('data_full/backtest_trades.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

const months = {};

for (const t of trades) {
  const month = t.game_date.slice(0, 7); // e.g. "2025-04"
  if (!months[month]) months[month] = { wins: [], losses: [] };
  if (t.pnl_dollars > 0) months[month].wins.push(t.pnl_dollars);
  else months[month].losses.push(t.pnl_dollars);
}

for (const [month, data] of Object.entries(months).sort()) {
  const wins = data.wins.length;
  const losses = data.losses.length;
  const avg_win = wins > 0 ? data.wins.reduce((a, b) => a + b, 0) / wins : 0;
  const avg_loss =
    losses > 0 ? data.losses.reduce((a, b) => a + b, 0) / losses : 0;
  const total_pnl = [...data.wins, ...data.losses].reduce((a, b) => a + b, 0);
  console.log(
    JSON.stringify({
      month,
      wins,
      losses,
      avg_win: +avg_win.toFixed(2),
      avg_loss: +avg_loss.toFixed(2),
      total_pnl: +total_pnl.toFixed(2),
    })
  );
}
