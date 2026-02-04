async function nwsGetJson(url, ua) {
  const res = await fetch(url, { headers: { 'User-Agent': ua, 'Accept': 'application/geo+json' } });
  if (!res.ok) throw new Error(`NWS HTTP ${res.status} ${url}`);
  return res.json();
}

async function getNwsGrid(lat, lon, ua) {
  const j = await nwsGetJson(`https://api.weather.gov/points/${lat},${lon}`, ua);
  const p = j?.properties || {};
  return { office: p.gridId, gridX: p.gridX, gridY: p.gridY };
}

export async function forecastHighInWindowF({ lat, lon, ua, windowStartIso, windowEndIso }) {
  const g = await getNwsGrid(lat, lon, ua);
  const j = await nwsGetJson(`https://api.weather.gov/gridpoints/${g.office}/${g.gridX},${g.gridY}/forecast/hourly`, ua);
  const periods = j?.properties?.periods || [];
  const start = Date.parse(windowStartIso);
  const end = Date.parse(windowEndIso);

  let maxF = null;
  for (const p of periods) {
    const t = Date.parse(p?.startTime);
    if (!Number.isFinite(t)) continue;
    if (t < start || t > end) continue;
    const temp = Number(p?.temperature);
    if (!Number.isFinite(temp)) continue;
    if (maxF == null || temp > maxF) maxF = temp;
  }

  return { maxF, grid: g };
}
