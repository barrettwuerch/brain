import fs from 'node:fs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function reviewGame(gameId, payload) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');

  const systemPrompt = `You are BeanBot's post-game analyst. You review NBA live probability trading decisions made by an automated bot on Kalshi. The bot's strategy: buy heavily-favored teams (pregame ≥65%) when their live win probability drops to 30–50% during Q1–Q3, targeting a recovery to 68%. Your job is to review what happened in this game and return a structured JSON analysis. Be concise and data-driven. Focus on whether the bot's decisions were correct given the information available at the time — not just whether they worked out.`;

  const userPrompt = `Review this game and return ONLY valid JSON with no markdown fencing: ${JSON.stringify(payload, null, 2)}\nReturn this exact structure: { "decision_quality": "good" | "marginal" | "questionable", "thesis_held": true | false, "pattern_tag": "fast_drop_recovery" | "slow_grind" | "blowout_avoided" | "late_game_comeback" | "correct_skip" | "missed_entry" | "other", "observations": [string, string], "parameter_flags": { "entry_timing": "optimal" | "early" | "late" | "n/a", "confidence_score": "calibrated" | "overconfident" | "underconfident" | "n/a", "exit_timing": "optimal" | "too_early" | "too_late" | "n/a" }, "suggested_adjustments": [] }`;

  await sleep(2000);

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  const data = await resp.json();
  const text = data?.content?.[0]?.text || '';
  const clean = String(text).replace(/```json|```/g, '').trim();
  const review = JSON.parse(clean);

  appendPatternLibrary(gameId, review);
  return review;
}

export function appendPatternLibrary(gameId, review) {
  const entry = {
    game_id: gameId,
    reviewed_at: new Date().toISOString(),
    pattern_tag: review.pattern_tag,
    decision_quality: review.decision_quality,
    thesis_held: review.thesis_held,
    parameter_flags: review.parameter_flags,
    observations: review.observations,
  };
  fs.appendFileSync('logs/pattern_library.jsonl', JSON.stringify(entry) + '\n');
}

export function logReviewerError(err, payload) {
  fs.appendFileSync('logs/reviewer_errors.jsonl', JSON.stringify({
    t: Date.now(),
    error: String(err?.message || err),
    stack: err?.stack || null,
    payloadMeta: { game_id: payload?.game_id || null },
  }) + '\n');
}
