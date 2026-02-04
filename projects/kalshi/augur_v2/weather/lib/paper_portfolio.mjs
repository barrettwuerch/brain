import fs from 'node:fs';
import path from 'node:path';

export function loadPositions(file) {
  try {
    if (!fs.existsSync(file)) return { updatedAt: null, balance: null, positions: [] };
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { updatedAt: null, balance: null, positions: [] };
  }
}

export function savePositions(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...obj, updatedAt: new Date().toISOString() }, null, 2));
}

export function computeDeployed(positions) {
  // Each contract costs entryPrice * qty dollars.
  let deployed = 0;
  for (const p of positions) {
    if (p.status !== 'open') continue;
    deployed += (Number(p.entryPrice) || 0) * (Number(p.qty) || 0);
  }
  return deployed;
}
