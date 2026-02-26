import 'dotenv/config';

import * as crypto from 'node:crypto';

const rawKey = process.env.KALSHI_PRIVATE_KEY ?? '';
console.log('key length:', rawKey.length);
console.log('first 50 chars (hex):', Buffer.from(rawKey.slice(0, 50)).toString('hex'));
console.log('starts with correct header:', rawKey.trimStart().startsWith('-----BEGIN'));
console.log('contains literal \\n:', rawKey.includes('\\n'));
console.log('contains real newlines:', rawKey.includes('\n'));

const fixedKey = rawKey
  .replace(/^\uFEFF/, '') // strip BOM
  .replace(/\\n/g, '\n') // fix escaped newlines
  .trim(); // strip leading/trailing whitespace

try {
  const keyObj = crypto.createPrivateKey({ key: fixedKey, format: 'pem' });
  console.log('key parsed OK — type:', keyObj.asymmetricKeyType);
} catch (e: any) {
  console.log('key parse FAILED:', e?.message ?? String(e));
}
