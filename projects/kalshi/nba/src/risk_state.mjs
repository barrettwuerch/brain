import fs from 'node:fs';
import path from 'node:path';

function isoDateLocal(d = new Date()) {
  // local date yyyy-mm-dd
  const tzOff = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOff).toISOString().slice(0, 10);
}

function weekKeyLocal(d = new Date()) {
  // Monday-start week key, local time
  const dd = new Date(d);
  const day = dd.getDay(); // 0 Sun .. 6 Sat
  const diffToMon = (day + 6) % 7;
  dd.setDate(dd.getDate() - diffToMon);
  dd.setHours(0, 0, 0, 0);
  return isoDateLocal(dd);
}

export class RiskState {
  constructor({ file, startingCapital }) {
    this.file = file;
    this.startingCapital = startingCapital;
    this.state = this._load() || {
      startingCapital,
      currentCapital: startingCapital,
      hardStopped: false,
      daily: { key: isoDateLocal(), deployed: 0 },
      weekly: { key: weekKeyLocal(), startCapital: startingCapital },
    };

    // roll keys if needed
    this._roll();
    this.save();
  }

  _load() {
    try {
      if (!fs.existsSync(this.file)) return null;
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  _roll(now = new Date()) {
    const dKey = isoDateLocal(now);
    const wKey = weekKeyLocal(now);

    if (this.state.daily?.key !== dKey) {
      this.state.daily = { key: dKey, deployed: 0 };
    }
    if (this.state.weekly?.key !== wKey) {
      this.state.weekly = { key: wKey, startCapital: this.state.currentCapital };
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  get startingCapital() { return this.state.startingCapital; }

  get currentCapital() { return this.state.currentCapital; }
  set currentCapital(v) { this.state.currentCapital = v; }

  get dailyDeployed() { return this.state.daily.deployed; }
  set dailyDeployed(v) { this.state.daily.deployed = v; }

  get weekStartCapital() { return this.state.weekly.startCapital; }
  set weekStartCapital(v) { this.state.weekly.startCapital = v; }

  get hardStopped() { return !!this.state.hardStopped; }
  set hardStopped(v) { this.state.hardStopped = !!v; }

  tick() {
    this._roll();
  }
}
