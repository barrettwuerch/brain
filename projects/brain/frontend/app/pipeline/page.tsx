'use client'

import { PipelineFunnel } from '@/components/pipeline-funnel'
import { usePipeline } from '@/hooks/use-pipeline'
import { useEffect, useState } from 'react'

export default function PipelinePage() {
  const { data, error, loading } = usePipeline()
  const [gateStats, setGateStats] = useState<any>(null)

  useEffect(() => {
    const fetchGateStats = async () => {
      try {
        const res = await fetch('/api/gate-stats', { cache: 'no-store' })
        const j = await res.json()
        if (res.ok && j.ok) setGateStats(j)
      } catch {
        // ignore
      }
    }

    fetchGateStats()
    const iv = setInterval(fetchGateStats, 30000)
    return () => clearInterval(iv)
  }, [])

  return (
    <div>
      <h1 className="text-xl font-semibold">Pipeline</h1>
      {error ? <div className="mt-4 rounded border border-rose-800 bg-rose-950/40 p-3 text-sm">{error}</div> : null}
      {loading && !data ? <div className="mt-4 text-sm text-zinc-400">Loading…</div> : null}

      <div className="mt-6">
        <PipelineFunnel funnel={data?.funnel} />
      </div>

      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Scanner Gate Blocks (24h)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {['gate_0', 'gate_1', 'gate_2', 'gate_3'].map((gate) => (
            <div key={gate} className="rounded-lg bg-zinc-800/50 p-3 text-center">
              <div className="text-xs text-zinc-500 uppercase mb-1">{gate.replace('_', ' ').toUpperCase()}</div>
              <div className="text-2xl font-bold text-white">{gateStats?.gateCounts?.[gate] ?? 0}</div>
              <div className="text-xs text-zinc-600 mt-1">blocks</div>
            </div>
          ))}
        </div>

        {gateStats?.recent?.length > 0 ? (
          <div className="mt-4">
            <div className="text-xs text-zinc-500 uppercase mb-2">Recent blocks</div>
            <div className="space-y-1">
              {gateStats.recent.slice(0, 5).map((b: any, i: number) => (
                <div key={i} className="text-xs text-zinc-400 flex gap-2">
                  <span className="text-zinc-600">{new Date(b.created_at).toLocaleTimeString()}</span>
                  <span className="text-yellow-500">{b.gate}</span>
                  <span className="font-mono truncate max-w-[120px]">{b.ticker ?? '—'}</span>
                  <span className="text-zinc-500 truncate">{b.reason}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-sm font-medium">Under Review</div>
          <div className="mt-3 space-y-3">
            {(data?.under_review ?? []).slice(0, 10).map((f: any) => (
              <div key={f.id} className="rounded-lg border border-zinc-800 p-3">
                <div className="text-xs text-zinc-400">{f.status}</div>
                <div className="mt-1 text-sm text-zinc-200 line-clamp-2">{f.description}</div>
              </div>
            ))}
            {!data?.under_review?.length ? <div className="text-sm text-zinc-400">None</div> : null}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-sm font-medium">Dead Ends</div>
          <div className="mt-1 text-xs text-zinc-400">Count: {data?.dead_ends?.count ?? 0}</div>
          <div className="mt-3 space-y-3">
            {(data?.dead_ends?.last5 ?? []).map((f: any) => (
              <div key={f.id} className="rounded-lg border border-zinc-800 p-3">
                <div className="text-xs text-zinc-400">{f.created_at}</div>
                <div className="mt-1 text-sm text-zinc-200 line-clamp-2">{f.description}</div>
              </div>
            ))}
            {!data?.dead_ends?.last5?.length ? <div className="text-sm text-zinc-400">None</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
