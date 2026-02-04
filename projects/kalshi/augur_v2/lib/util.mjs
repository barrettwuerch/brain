import fs from 'node:fs';
import path from 'node:path';

export function parseEnvFile(s) {
  const out = {};
  for (const line of String(s).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

export function loadEnvFile(p) {
  if (!p || !fs.existsSync(p)) return {};
  return parseEnvFile(fs.readFileSync(p, 'utf8'));
}

export function safeMkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

export function jsonlWriter(dir, prefix = 'scanner') {
  safeMkdirp(dir);
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `${prefix}_${day}.jsonl`);
  return { file, write: (obj) => fs.appendFileSync(file, JSON.stringify(obj) + '\n') };
}

export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export function toDays(ms) { return ms / 86400000; }

export function annualizedYield({ price, days }) {
  if (!(price > 0 && days > 0)) return null;
  return ((1 - price) / price) * (365 / days);
}
