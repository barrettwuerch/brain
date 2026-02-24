// Level 1 task generator (Phase 1 scaffold)
// Loads a public CSV dataset, computes ground truth, and inserts gradeable tasks.

import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

type CpiRow = { date: string; value: number };

// FRED CPI series (monthly). CSV download endpoint.
const DATA_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL';

async function fetchCsv(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch failed ${resp.status} for ${url}`);
  return await resp.text();
}

function parseCpi(csv: string): CpiRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift();
  if (!header) throw new Error('missing header');

  // Expected columns from FRED: DATE,VALUE
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

function maxRow(rows: CpiRow[]) {
  return rows.reduce((best, r) => (r.value > best.value ? r : best), rows[0]);
}

function maxMoM(rows: CpiRow[]) {
  let best = { date: rows[1].date, delta: rows[1].value - rows[0].value };
  for (let i = 1; i < rows.length; i++) {
    const delta = rows[i].value - rows[i - 1].value;
    if (delta > best.delta) best = { date: rows[i].date, delta };
  }
  return best;
}

function trendLastN(rows: CpiRow[], n: number): 'up' | 'down' | 'flat' {
  const slice = rows.slice(-n);
  const first = slice[0].value;
  const last = slice[slice.length - 1].value;
  const diff = last - first;
  const eps = 1e-9;
  if (diff > eps) return 'up';
  if (diff < -eps) return 'down';
  return 'flat';
}

async function insertTask(task_type: string, task_input: Record<string, any>) {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type,
    task_input,
    status: 'queued',
    tags: ['level1', 'cpi'],
  });
  if (error) throw error;
}

async function main() {
  const csv = await fetchCsv(DATA_URL);
  const rows = parseCpi(csv);
  if (rows.length < 10) throw new Error('dataset too small');

  const max = maxRow(rows);
  const mom = maxMoM(rows);
  const trend6 = trendLastN(rows, 6);

  // Tasks are gradeable because we embed the ground truth in task_input.
  // The agent must still compute/answer; the grader can compare.
  await insertTask('pattern_find', {
    dataset: { name: 'CPI', url: DATA_URL },
    question: 'What is the highest CPI value in this series, and what month did it occur?',
    expected_answer: { date: max.date, value: max.value },
  });

  await insertTask('pattern_find', {
    dataset: { name: 'CPI', url: DATA_URL },
    question: 'What month had the largest month-over-month CPI change, and what was the delta?',
    expected_answer: { date: mom.date, delta: mom.delta },
  });

  await insertTask('trend_prediction', {
    dataset: { name: 'CPI', url: DATA_URL },
    question: 'Is the CPI series trending up, down, or flat over the last 6 months?',
    expected_answer: { trend: trend6 },
  });

  console.log('Inserted 3 Level 1 tasks into tasks queue.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
