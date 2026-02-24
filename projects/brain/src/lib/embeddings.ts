// THE BRAIN — Embeddings wrapper (OpenAI)

import 'dotenv/config';
import crypto from 'node:crypto';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function isTestMode() {
  return String(process.env.BRAIN_TEST_MODE || '').toLowerCase() === 'true';
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromText(text: string): number {
  const h = crypto.createHash('sha256').update(text).digest();
  // take first 4 bytes
  return h.readUInt32LE(0);
}

/**
 * Embed a string into a 1536-dimension vector.
 *
 * Production: OpenAI `text-embedding-3-small`.
 * Test mode (BRAIN_TEST_MODE=true): deterministic pseudo-random vector seeded by text.
 */
export async function embed(text: string): Promise<number[]> {
  if (isTestMode()) {
    const rand = mulberry32(seedFromText(text));
    const v: number[] = [];
    for (let i = 0; i < 1536; i++) {
      // roughly centered around 0
      v.push((rand() - 0.5) * 2);
    }
    return v;
  }

  const apiKey = req('OPENAI_API_KEY');

  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  const raw = await resp.text();
  if (!resp.ok) throw new Error(`OpenAI embeddings error ${resp.status}: ${raw}`);

  const data = JSON.parse(raw);
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('Embeddings response missing embedding array');
  return vec as number[];
}
