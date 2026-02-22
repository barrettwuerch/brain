#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { parseArgs } from '../src/util.mjs';
import { reviewGame, logReviewerError } from '../src/claude_reviewer.mjs';

function loadLatestDatasetFile(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('dataset_') && f.endsWith('.jsonl'))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error(`No dataset_*.jsonl found in ${dir}`);
  return path.join(dir, files[0].f);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const game = args.game;
  const dir = args.dir || './data_full';
  if (!game) throw new Error('Usage: node scripts/test_reviewer.mjs --game <KXNBAGAME-...>');

  const file = loadLatestDatasetFile(dir);
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  const ev = rows.find(r => r.type === 'qualifying_event' && r.game_id === game) || rows.find(r => r.game_id === game);
  if (!ev) throw new Error(`Game not found in dataset: ${game}`);

  // Minimal payload stub for now
  const payload = {
    game_id: game,
    game_date: ev.game_date,
    pregame_prob: ev.pregame_prob,
    pregame_team: ev.favorite_team,
    final_score: null,
    entry_checks: [],
    trade: ev.type === 'qualifying_event' ? {
      entry_prob: ev.entry_prob,
      entry_quarter: ev.entry_quarter,
      confidence: null,
      exit_prob: null,
      exit_reason: null,
      pnl_cents: ev.implied_pnl_cents,
      hold_time_sec: ev.time_to_recover_sec,
    } : null,
    prob_timeline: [],
  };

  try {
    const review = await reviewGame(game, payload);
    console.log(JSON.stringify(review, null, 2));
  } catch (e) {
    logReviewerError(e, payload);
    console.error(e);
    process.exit(1);
  }
}

main();
