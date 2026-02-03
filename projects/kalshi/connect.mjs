#!/usr/bin/env node
/**
 * Kalshi connection smoke test (read-only).
 *
 * Loads secrets from /Users/bear/.openclaw/secrets/kalshi.env by default.
 * Requires:
 *   KALSHI_API_KEY=<Key ID>
 *   KALSHI_PRIVATE_KEY_PATH=<path to PEM>
 * Optional:
 *   KALSHI_BASE_URL=https://trading-api.kalshi.com
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

function parseEnvFile(s) {
  const out = {};
  for (const line of s.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i === -1) continue;
    const k = trimmed.slice(0, i).trim();
    const v = trimmed.slice(i + 1).trim();
    out[k] = v;
  }
  return out;
}

function loadEnv(path) {
  const s = fs.readFileSync(path, 'utf8');
  return parseEnvFile(s);
}

function signPssBase64(privateKeyPem, text) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(text);
  signer.end();
  return signer
    .sign({
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString('base64');
}

async function main() {
  const envPath = process.env.KALSHI_ENV_FILE || '/Users/bear/.openclaw/secrets/kalshi.env';
  const env = fs.existsSync(envPath) ? loadEnv(envPath) : {};

  const keyId = process.env.KALSHI_API_KEY || env.KALSHI_API_KEY;
  const privateKeyPath = process.env.KALSHI_PRIVATE_KEY_PATH || env.KALSHI_PRIVATE_KEY_PATH;
  const baseUrl = (process.env.KALSHI_BASE_URL || env.KALSHI_BASE_URL || 'https://trading-api.kalshi.com').replace(/\/$/, '');

  if (!keyId) throw new Error(`Missing KALSHI_API_KEY (Key ID). Looked in env + ${envPath}`);
  if (!privateKeyPath) throw new Error(`Missing KALSHI_PRIVATE_KEY_PATH. Looked in env + ${envPath}`);

  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');

  // Safe, read-only endpoint.
  const method = 'GET';
  const path = '/trade-api/v2/portfolio/balance';

  const ts = Date.now().toString();
  const signPath = path.split('?')[0];
  const msg = ts + method + signPath;
  const sig = signPssBase64(privateKeyPem, msg);

  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      'KALSHI-ACCESS-KEY': keyId,
      'KALSHI-ACCESS-TIMESTAMP': ts,
      'KALSHI-ACCESS-SIGNATURE': sig,
    },
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  // Print minimal info (no secrets)
  console.log(JSON.stringify({
    ok: res.ok,
    status: res.status,
    baseUrl,
    path,
    // show only high-level fields
    keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 20) : null,
    sample: (data && typeof data === 'object') ? data : String(text).slice(0, 300)
  }, null, 2));

  process.exit(res.ok ? 0 : 2);
}

main().catch((err) => {
  console.error('KALSHI_CONNECT_ERROR:', err?.message || err);
  process.exit(1);
});
