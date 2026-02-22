import fs from 'node:fs';
import path from 'node:path';
import { safeMkdirp } from './util.mjs';

export class JsonStateStore {
  constructor({ dir, filename = 'state.json', log = null }) {
    this.dir = dir;
    this.file = path.join(dir, filename);
    this.log = log;
    safeMkdirp(dir);
    this.state = this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.file)) return { games: {} };
      const s = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!s.games) s.games = {};
      return s;
    } catch {
      this.log?.write?.({ t: Date.now(), type: 'warning', msg: 'state_load_failed', file: this.file });
      return { games: {} };
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  ensureGame(gameId) {
    const g = this.state.games[gameId] || (this.state.games[gameId] = {});
    return g;
  }
}
