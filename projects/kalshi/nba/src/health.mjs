import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cfgPath = path.join(root, 'config.paper.json');
if (!fs.existsSync(cfgPath)) throw new Error('Missing config.paper.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

for (const k of ['mode','kalshi','nba','pollIntervalMs','probability','execution','gameState','rules','risk','logging']) {
  if (!(k in cfg)) throw new Error(`Config missing key: ${k}`);
}

console.log('health ok');
