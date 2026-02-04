import fs from 'node:fs';
import path from 'node:path';

const KB_PATH = path.join(process.cwd(), 'kb', 'wedge_support_kb.md');

export function localKbSearch(query, { maxChars = 1400 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { ok: true, provider: 'local_md', found: false, snippets: [] };

  if (!fs.existsSync(KB_PATH)) {
    return { ok: false, provider: 'local_md', found: false, error: 'kb_missing', path: KB_PATH };
  }

  const text = fs.readFileSync(KB_PATH, 'utf8');
  const lines = text.split(/\r?\n/);

  // naive scoring: count occurrences per line window
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const l = line.toLowerCase();
    if (l.includes(q)) {
      const from = Math.max(0, i - 4);
      const to = Math.min(lines.length, i + 6);
      const snippet = lines.slice(from, to).join('\n');
      hits.push({ line: i + 1, snippet });
    }
  }

  const snippets = hits.slice(0, 3).map(h => {
    let s = h.snippet;
    if (s.length > maxChars) s = s.slice(0, maxChars) + '…';
    return { line: h.line, text: s };
  });

  return { ok: true, provider: 'local_md', found: snippets.length > 0, snippets };
}
