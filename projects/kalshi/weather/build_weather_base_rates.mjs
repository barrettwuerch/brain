#!/usr/bin/env node
/**
 * build_weather_base_rates.mjs
 *
 * Downloads 5y of daily observed TMAX from NOAA GHCNd and builds per-station/month
 * empirical distributions.
 *
 * Outputs:
 * - weather_base_rates.json
 * - weather_base_rates_sorted_values.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s1 = Math.sin(dLat/2);
  const s2 = Math.sin(dLon/2);
  const aa = s1*s1 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*s2*s2;
  return 2 * R * Math.asin(Math.sqrt(aa));
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
}

function parseGhcndStations(txt) {
  // Fixed width per ghcnd-stations.txt doc.
  const lines = txt.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const id = line.slice(0, 11).trim();
    const lat = Number(line.slice(12, 20).trim());
    const lon = Number(line.slice(21, 30).trim());
    const elev = Number(line.slice(31, 37).trim());
    const name = line.slice(41, 71).trim();
    const gsn = line.slice(72, 75).trim();
    const hcn = line.slice(76, 79).trim();
    const wmo = line.slice(80, 85).trim();
    if (!id) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ id, lat, lon, elev: Number.isFinite(elev) ? elev : null, name, gsn: !!gsn, hcn: !!hcn, wmo: wmo || null });
  }
  return out;
}

function parseDlyTmax(dlyText, { startYmd, endYmd }) {
  // Returns array of { ymd, tmaxF }.
  // .dly format: one line per station+element+month, 31 day values.
  const out = [];
  const lines = dlyText.split(/\r?\n/);

  const toF = (tenthsC) => (tenthsC / 10) * 9/5 + 32;

  for (const line of lines) {
    if (line.length < 269) continue;
    const element = line.slice(17, 21);
    if (element !== 'TMAX') continue;

    const year = Number(line.slice(11, 15));
    const month = Number(line.slice(15, 17));
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;

    for (let day = 1; day <= 31; day++) {
      const i = 21 + (day - 1) * 8;
      const v = Number(line.slice(i, i + 5));
      const mflag = line.slice(i + 5, i + 6);
      const qflag = line.slice(i + 6, i + 7);
      // const sflag = line.slice(i + 7, i + 8);
      if (!Number.isFinite(v) || v === -9999) continue;
      if (qflag && qflag.trim()) continue; // drop failed QC

      const ymd = `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      if (ymd < startYmd || ymd > endYmd) continue;

      const tmaxF = toF(v);
      // drop obviously broken values
      if (tmaxF < -80 || tmaxF > 130) continue;
      out.push({ ymd, tmaxF, mflag: mflag?.trim() || null });
    }
  }

  out.sort((a, b) => a.ymd.localeCompare(b.ymd));
  return out;
}

function mean(xs) {
  if (!xs.length) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stddev(xs) {
  if (xs.length < 2) return null;
  const mu = mean(xs);
  const v = xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const x = clamp(p, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  if (lo === hi) return sorted[lo];
  const w = x - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function histogram1F(values) {
  // returns [{binF, count}] where binF is integer temp.
  const counts = new Map();
  for (const v of values) {
    const b = Math.round(v); // 1F bins centered on integer
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  const bins = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([binF, count]) => ({ binF, count }));
  return bins;
}

async function main() {
  const citiesPath = arg('--cities', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/cities.json'));
  const outDir = arg('--outdir', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather'));
  const years = Number(arg('--years', '5'));

  const cities = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));

  const today = new Date();
  const endYmd = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - years * 365.25 * 24 * 3600_000);
  const startYmd = start.toISOString().slice(0, 10);

  const cacheDir = path.join(outDir, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  const stationsUrl = 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt';
  const stationsCache = path.join(cacheDir, 'ghcnd-stations.txt');
  if (!fs.existsSync(stationsCache)) {
    console.log('Downloading ghcnd-stations.txt ...');
    await fetchToFile(stationsUrl, stationsCache);
  }

  const stationsTxt = fs.readFileSync(stationsCache, 'utf8');
  const stations = parseGhcndStations(stationsTxt);

  const pickedStations = {};

  // Pick closest GHCNd station per city (by lat/lon).
  for (const [code, c] of Object.entries(cities)) {
    const lat = Number(c.lat);
    const lon = Number(c.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`City ${code} missing lat/lon`);

    const candidates = stations
      .map(s => ({ ...s, km: haversineKm(lat, lon, s.lat, s.lon) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 50);

    const pick = candidates[0];
    pickedStations[code] = {
      city: c.city,
      lat, lon,
      ghcndStationId: pick.id,
      ghcndStationName: pick.name,
      distanceKm: Number(pick.km.toFixed(2))
    };

    console.log(`${code}: picked GHCNd ${pick.id} (${pick.name}) dist=${pick.km.toFixed(2)}km`);
  }

  const sortedValues = {};
  const dailySeries = {};
  const summary = {
    generatedAt: new Date().toISOString(),
    window: { startYmd, endYmd, years },
    stations: pickedStations,
    months: {}
  };

  for (const [code, info] of Object.entries(pickedStations)) {
    const stId = info.ghcndStationId;
    const dlyUrl = `https://www.ncei.noaa.gov/pub/data/ghcn/daily/all/${stId}.dly`;
    const dlyCache = path.join(cacheDir, `${stId}.dly`);

    if (!fs.existsSync(dlyCache)) {
      console.log(`Downloading ${stId}.dly ...`);
      await fetchToFile(dlyUrl, dlyCache);
    }

    const dlyText = fs.readFileSync(dlyCache, 'utf8');
    const obs = parseDlyTmax(dlyText, { startYmd, endYmd });

    // Keep daily time series (chronological)
    dailySeries[code] = obs.map(o => ({ date: o.ymd, tmaxF: o.tmaxF }));

    // Group by month
    const byMonth = new Map(); // 1..12 -> [tmaxF]
    for (const o of obs) {
      const m = Number(o.ymd.slice(5, 7));
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m).push(o.tmaxF);
    }

    sortedValues[code] = {};
    summary.months[code] = {};

    for (let m = 1; m <= 12; m++) {
      const vals = (byMonth.get(m) || []).slice().sort((a, b) => a - b);
      sortedValues[code][String(m).padStart(2, '0')] = vals;

      const mu = mean(vals);
      const sd = stddev(vals);
      const p10 = percentile(vals, 0.10);
      const p25 = percentile(vals, 0.25);
      const p50 = percentile(vals, 0.50);
      const p75 = percentile(vals, 0.75);
      const p90 = percentile(vals, 0.90);

      summary.months[code][String(m).padStart(2, '0')] = {
        n: vals.length,
        meanF: mu == null ? null : Number(mu.toFixed(2)),
        stdDevF: sd == null ? null : Number(sd.toFixed(2)),
        p10F: p10 == null ? null : Number(p10.toFixed(2)),
        p25F: p25 == null ? null : Number(p25.toFixed(2)),
        p50F: p50 == null ? null : Number(p50.toFixed(2)),
        p75F: p75 == null ? null : Number(p75.toFixed(2)),
        p90F: p90 == null ? null : Number(p90.toFixed(2)),
        histogram1F: histogram1F(vals)
      };
    }
  }

  const out1 = path.join(outDir, 'weather_base_rates.json');
  const out2 = path.join(outDir, 'weather_base_rates_sorted_values.json');
  const out3 = path.join(outDir, 'weather_daily_series.json');
  fs.writeFileSync(out1, JSON.stringify(summary, null, 2));
  fs.writeFileSync(out2, JSON.stringify(sortedValues, null, 2));
  fs.writeFileSync(out3, JSON.stringify(dailySeries, null, 2));

  console.log(`\nWrote:`);
  console.log('-', out1);
  console.log('-', out2);
  console.log('-', out3);

  // Print quick sigma table for current month
  const curMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  console.log(`\nActual σ by station for month=${curMonth} (from observed TMAX)`);
  for (const [code, months] of Object.entries(summary.months)) {
    const row = months[curMonth];
    console.log(`${code}: n=${row.n} meanF=${row.meanF} stdDevF=${row.stdDevF}`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});
