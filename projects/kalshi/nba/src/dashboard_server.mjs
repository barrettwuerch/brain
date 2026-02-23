#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { build } from 'esbuild';

import { parseArgs } from './util.mjs';
import { loadStateFromJsonl } from './state_api.mjs';

function resolveRel(fromFile, rel) {
  return path.resolve(path.dirname(fromFile), rel);
}

async function bundleDashboard({ dashboardDir, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const entry = path.join(dashboardDir, 'main.jsx');
  const outfile = path.join(outDir, 'bundle.js');

  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    sourcemap: true,
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    define: { 'process.env.NODE_ENV': '"development"' },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port || 3000);

  const nbaRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const dashboardDir = path.join(nbaRoot, 'dashboard');
  const publicDir = path.join(dashboardDir, 'dist');
  const logsDir = path.join(nbaRoot, 'logs');
  const cfgPath = path.join(nbaRoot, 'config.paper.json');

  // Build bundle at startup
  await bundleDashboard({ dashboardDir, outDir: publicDir });

  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : null;
  const startingCapitalUsd = cfg?.risk?.startingCapital ?? cfg?.risk?.paperAccountBalanceUsd ?? 0;
  const feeRate = cfg?.risk?.assumedFeeRateOnWinnings ?? 0.01;

  const app = express();

  // Static
  app.get('/', (req, res) => res.sendFile(path.join(dashboardDir, 'index.html')));
  app.use(express.static(publicDir));

  // API
  app.get('/api/state', (req, res) => {
    const isoDate = String(req.query.date || new Date().toISOString().slice(0, 10));
    try {
      const state = loadStateFromJsonl({ logsDir, isoDate, startingCapitalUsd, feeRateOnWinnings: feeRate });
      res.json(state);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.listen(port, () => {
    console.log(`Dashboard running on http://localhost:${port}`);
    console.log(`Logs: ${logsDir}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
