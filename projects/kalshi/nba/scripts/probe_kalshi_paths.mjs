#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { KalshiClient } from '../src/kalshi_client.mjs';
import { loadEnvFile, parseArgs } from '../src/util.mjs';

function mustRead(p) { return fs.readFileSync(p, 'utf8'); }

function loadCfg(cfgPath) {
  const abs = path.isAbsolute(cfgPath) ? cfgPath : path.resolve(process.cwd(), cfgPath);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

async function tryPath(client, p) {
  try {
    const r = await client.signedFetch('GET', p);
    return { path: p, ok: true, keys: Object.keys(r || {}).slice(0, 20), sample: r };
  } catch (e) {
    return { path: p, ok: false, status: e?.status || null, data: e?.data || null, msg: String(e?.message || e) };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfgPath = args.config || './config.paper.json';
  const cfg = loadCfg(cfgPath);

  const envFromFile = loadEnvFile(cfg.kalshi.envFile);
  const keyId = (cfg.kalshi.keyIdPath && fs.existsSync(cfg.kalshi.keyIdPath))
    ? mustRead(cfg.kalshi.keyIdPath).trim()
    : (envFromFile[cfg.kalshi.keyIdEnv] || process.env[cfg.kalshi.keyIdEnv]);
  const privateKeyPem = (cfg.kalshi.privateKeyPemPath && fs.existsSync(cfg.kalshi.privateKeyPemPath))
    ? mustRead(cfg.kalshi.privateKeyPemPath)
    : (envFromFile[cfg.kalshi.privateKeyEnv] || process.env[cfg.kalshi.privateKeyEnv]);

  const client = new KalshiClient({ baseUrl: cfg.kalshi.baseUrl, keyId, privateKeyPem });

  const paths = [
    '/historical/cutoff',
    '/trade-api/v2/historical/cutoff',
    '/trade-api/v2/historical/markets',
    '/trade-api/v2/historical/markets/KXNBAGAME-26FEB22BKNATL-ATL/candlesticks',
    '/historical/markets/KXNBAGAME-26FEB22BKNATL-ATL/candlesticks',
    `/trade-api/v2/series/${cfg.nba.seriesTicker}/markets/KXNBAGAME-26FEB22BKNATL-ATL/candlesticks`,
    '/markets/candlesticks',
    '/trade-api/v2/markets/candlesticks',
  ];

  for (const p of paths) {
    const r = await tryPath(client, p);
    console.log(JSON.stringify(r));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
