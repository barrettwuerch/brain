import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

type Usage = { input_tokens?: number; output_tokens?: number };

export async function callAnthropicWithRetry(
  params: {
    system: string;
    user: string;
    model: string;
    max_tokens: number;
    temperature: number;
  },
  context: { task_type?: string; bot_id?: string } = {},
  maxRetries = 3,
): Promise<{ text: string; usage: Usage }> {
  const key = String(process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!key) throw new Error('Missing env ANTHROPIC_API_KEY');

  const delays = [1000, 2000, 4000];
  let lastErr: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': key,
        },
        body: JSON.stringify({
          model: params.model,
          max_tokens: params.max_tokens,
          temperature: params.temperature,
          system: params.system,
          messages: [{ role: 'user', content: params.user }],
        }),
      });

      const raw = await resp.text();
      if (!resp.ok) {
        const err: any = new Error(`Anthropic error ${resp.status}: ${raw}`);
        err.status = resp.status;
        throw err;
      }

      const data = JSON.parse(raw);
      const out = (data?.content || [])
        .map((c: any) => c?.text)
        .filter(Boolean)
        .join('\n');

      const usage: Usage = data?.usage ?? {};

      // Track cost (best-effort)
      try {
        const cost = estimateTokenCost(
          { input_tokens: Number(usage.input_tokens ?? 0), output_tokens: Number(usage.output_tokens ?? 0) },
          params.model,
        );
        await supabaseAdmin.from('api_cost_log').insert({
          model: params.model,
          cost_usd: cost,
          task_type: context.task_type ?? null,
          bot_id: context.bot_id ?? null,
        });
      } catch (e: any) {
        console.warn('[anthropic] cost log failed (non-fatal):', e?.message ?? e);
      }

      return { text: out, usage };
    } catch (err: any) {
      lastErr = err;
      const status = Number(err?.status ?? 0);
      const isRetryable = status === 429 || status >= 500;
      if (isRetryable && attempt < maxRetries) {
        const d = delays[Math.min(attempt, delays.length - 1)];
        console.warn(`[anthropic] Attempt ${attempt + 1} failed (${status}), retrying in ${d}ms`);
        await new Promise((r) => setTimeout(r, d));
        continue;
      }
      throw err;
    }
  }

  throw lastErr ?? new Error('unknown');
}

function estimateTokenCost(usage: { input_tokens: number; output_tokens: number }, model: string): number {
  // Approximate rates. Sonnet: ~$3/M input, $15/M output. Opus higher.
  const inputRate = model.includes('opus') ? 0.000015 : 0.000003;
  const outputRate = model.includes('opus') ? 0.000075 : 0.000015;
  return usage.input_tokens * inputRate + usage.output_tokens * outputRate;
}
