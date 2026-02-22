#!/usr/bin/env node
import { parseArgs } from './util.mjs';
import { score } from './scorer.mjs';

const args = parseArgs(process.argv.slice(2));

const s = score({
  entry_prob: args.entry_prob ? Number(args.entry_prob) : undefined,
  entry_quarter: args.entry_quarter ? Number(args.entry_quarter) : undefined,
  clock_remaining_sec: args.clock_remaining_sec ? Number(args.clock_remaining_sec) : undefined,
  score_deficit: args.score_deficit ? Number(args.score_deficit) : undefined,
  momentum_3min: args.momentum_3min ? Number(args.momentum_3min) : undefined,
});

console.log(JSON.stringify({ score: s }));
