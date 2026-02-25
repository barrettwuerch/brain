// THE BRAIN — Anthropic client helper (JSON-only response)

import 'dotenv/config';


export async function claudeText(params: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const { callAnthropicWithRetry } = await import('../utils/anthropic_client');
  const out = await callAnthropicWithRetry(
    {
      system: params.system,
      user: params.user,
      model: params.model ?? 'claude-sonnet-4-6',
      max_tokens: params.maxTokens ?? 900,
      temperature: params.temperature ?? 0.2,
    },
    {},
  );
  return out.text;
}

export function extractFirstJsonObject(s: string): any {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) throw new Error('No JSON object found in response');
  return JSON.parse(s.slice(start, end + 1));
}
