// THE BRAIN — Embeddings wrapper
//
// Block 5 policy: do NOT require OpenAI. Prefer Voyage (Anthropic partner) when available.
//
// Current implementation:
// - If VOYAGE_API_KEY is set: uses Voyage embeddings endpoint (model: voyage-3)
// - Otherwise: deterministic hash-based embedding (stable across runs)
//
// NOTE: The DB schema expects vector(1536) for embeddings, so this module always returns 1536 dims.

import 'dotenv/config';
import crypto from 'node:crypto';

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

function deterministicEmbed1536(text: string): number[] {
  const rand = mulberry32(seedFromText(text));
  const v: number[] = [];
  for (let i = 0; i < 1536; i++) {
    // roughly centered around 0
    v.push((rand() - 0.5) * 2);
  }
  return v;
}

function normalizeTo1536(vec: number[]): number[] {
  if (vec.length === 1536) return vec;
  const out = new Array(1536).fill(0);
  for (let i = 0; i < 1536; i++) out[i] = Number(vec[i % vec.length] ?? 0);
  return out;
}

/**
 * Embed a string into a 1536-dimension vector.
 */
export async function embed(text: string): Promise<number[]> {
  // In test mode, always deterministic.
  if (isTestMode()) return deterministicEmbed1536(text);

  const voyageKey = String(process.env.VOYAGE_API_KEY ?? '').trim();
  if (!voyageKey) {
    // TODO(Block 6): wire Voyage AI properly (key management, batching, error budgets).
    // For Block 5 gates we use deterministic embeddings so the system is not blocked.
    return deterministicEmbed1536(text);
  }

  const resp = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${voyageKey}`,
    },
    body: JSON.stringify({
      model: 'voyage-3',
      input: text,
    }),
  });

  const raw = await resp.text();
  if (!resp.ok) throw new Error(`Voyage embeddings error ${resp.status}: ${raw}`);

  const data = JSON.parse(raw);
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('Voyage embeddings response missing embedding array');

  return normalizeTo1536(vec as number[]);
}
