// THE BRAIN — Anthropic client helper (JSON-only response)

import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const API_KEY: string = req('ANTHROPIC_API_KEY');

export async function claudeText(params: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({
      model: params.model ?? 'claude-sonnet-4-6',
      max_tokens: params.maxTokens ?? 900,
      temperature: params.temperature ?? 0.2,
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
    }),
  });

  const raw = await resp.text();
  if (!resp.ok) throw new Error(`Anthropic error ${resp.status}: ${raw}`);

  const data = JSON.parse(raw);
  const out = (data?.content || [])
    .map((c: any) => c?.text)
    .filter(Boolean)
    .join('\n');
  return out;
}

export function extractFirstJsonObject(s: string): any {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) throw new Error('No JSON object found in response');
  return JSON.parse(s.slice(start, end + 1));
}
