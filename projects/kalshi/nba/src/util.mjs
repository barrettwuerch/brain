import fs from 'node:fs';
import path from 'node:path';

export function nowMs() { return Date.now(); }
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const val = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    out[key] = val;
  }
  return out;
}

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
  if (!p) return {};
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  if (!fs.existsSync(abs)) return {};
  return parseEnvFile(fs.readFileSync(abs, 'utf8'));
}

export function safeMkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function jsonlLogger(dir) {
  safeMkdirp(dir);
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `${day}.jsonl`);
  return {
    file,
    write: (obj) => fs.appendFileSync(file, JSON.stringify(obj) + '\n'),
  };
}

export function clampInt(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}
