import { loadEnv } from '../lib/env.mjs';

try {
  const env = loadEnv();
  console.log(JSON.stringify({ ok: true, keys: Object.keys(env).sort() }, null, 2));
  process.exit(0);
} catch (e) {
  console.error('SELF_CHECK_FAILED:', e?.message || e);
  process.exit(1);
}
