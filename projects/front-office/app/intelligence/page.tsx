'use client'

import { ISScoreBar } from '@/components/is-score-bar'
import { useIsScores } from '@/hooks/use-is-scores'

export default function IntelligencePage() {
  const { data: rows, error, loading } = useIsScores()

  // Latest per task_type
  const latest = new Map<string, any>()
  for (const r of rows ?? []) {
    const tt = String(r.task_type ?? 'unknown')
    if (!latest.has(tt)) latest.set(tt, r)
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">Intelligence</h1>

      {error ? <div className="mt-4 rounded border border-rose-800 bg-rose-950/40 p-3 text-sm">{error}</div> : null}
      {loading && !rows ? <div className="mt-4 text-sm text-zinc-400">Loading…</div> : null}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from(latest.values()).slice(0, 20).map((r) => (
          <ISScoreBar key={r.id} row={r} />
        ))}
      </div>
    </div>
  )
}
