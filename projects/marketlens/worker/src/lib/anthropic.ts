/** Minimal Anthropic (Claude) client for worker jobs.
 * Uses `fetch` (Node 18+). No extra deps.
 */

import 'dotenv/config';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('Missing env ANTHROPIC_API_KEY');
const API_KEY: string = apiKey;

export async function claudeJson({ system, user }: { system: string; user: string }) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 900,
      temperature: 0.2,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`Anthropic error ${resp.status}: ${text}`);

  const data = JSON.parse(text);
  // content: [{type:'text', text:'...'}]
  const out = (data?.content || []).map((c: any) => c?.text).filter(Boolean).join('\n');
  return out;
}

export function extractFirstJsonObject(s: string): any {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) throw new Error('No JSON object found in response');
  const slice = s.slice(start, end + 1);
  return JSON.parse(slice);
}
