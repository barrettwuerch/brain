import fs from 'node:fs';

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export async function cdoFetchJson({ baseUrl, token, path, query }) {
  const url = baseUrl.replace(/\/$/, '') + path + (query ? ('?' + new URLSearchParams(query).toString()) : '');
  const res = await fetch(url, { headers: { token } });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`CDO HTTP ${res.status} ${path}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function getDailyTmaxF({ baseUrl, token, stationId, dateYmd }) {
  // CDO GHCND daily TMAX is tenths of °C.
  const j = await cdoFetchJson({
    baseUrl,
    token,
    path: '/data',
    query: {
      datasetid: 'GHCND',
      datatypeid: 'TMAX',
      stationid: stationId,
      startdate: dateYmd,
      enddate: dateYmd,
      limit: '1000',
      units: 'standard',
    }
  });
  const rec = (j?.results || []).find(r => r.datatype === 'TMAX');
  if (!rec) return null;
  const v = Number(rec.value);
  if (!Number.isFinite(v)) return null;
  // With units=standard, value should already be °F.
  return v;
}

export async function getDailyTminF({ baseUrl, token, stationId, dateYmd }) {
  const j = await cdoFetchJson({
    baseUrl,
    token,
    path: '/data',
    query: {
      datasetid: 'GHCND',
      datatypeid: 'TMIN',
      stationid: stationId,
      startdate: dateYmd,
      enddate: dateYmd,
      limit: '1000',
      units: 'standard',
    }
  });
  const rec = (j?.results || []).find(r => r.datatype === 'TMIN');
  if (!rec) return null;
  const v = Number(rec.value);
  if (!Number.isFinite(v)) return null;
  return v;
}
