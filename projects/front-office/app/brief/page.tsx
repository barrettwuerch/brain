'use client'

import { useBrief } from '@/hooks/use-brief'

function pretty(x: any) {
  try {
    return JSON.stringify(x, null, 2)
  } catch {
    return String(x)
  }
}

export default function BriefPage() {
  const { data: ep, loading, error } = useBrief()

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl md:text-2xl font-semibold">Daily Brief</h1>

      {error ? <div className="mt-4 rounded border border-rose-800 bg-rose-950/40 p-3 text-sm">{error}</div> : null}
      {loading && !ep ? <div className="mt-4 text-sm text-zinc-400">Loading…</div> : null}

      {!ep ? (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:p-8">
          <div className="text-lg font-medium">Brief will arrive tomorrow morning</div>
          <div className="mt-2 text-sm text-zinc-400">No generate_daily_brief episode found yet.</div>
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:p-8">
          <div className="text-sm text-zinc-400">Generated {new Date(ep.created_at).toLocaleString()}</div>
          <div className="mt-4">
            <div className="text-sm font-medium">action_taken</div>
            <pre className="mt-2 overflow-auto rounded-lg bg-black/40 p-3 text-xs">{pretty(ep.action_taken)}</pre>
          </div>
          <div className="mt-4">
            <div className="text-sm font-medium">observation</div>
            <pre className="mt-2 overflow-auto rounded-lg bg-black/40 p-3 text-xs">{pretty(ep.observation)}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
