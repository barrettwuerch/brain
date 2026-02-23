import fs from 'node:fs';
import path from 'node:path';

export function writeDailySummary({ logsDir, isoDate, summary }) {
  const file = path.join(logsDir, `daily_summary_${isoDate}.json`);
  fs.writeFileSync(file, JSON.stringify(summary, null, 2));
  return file;
}
