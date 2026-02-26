'use client'

import { PipelineFunnel } from '@/components/pipeline-funnel'
import { usePipeline } from '@/hooks/use-pipeline'

export default function PipelinePage() {
  const { data, error, loading } = usePipeline()

  return (
    <div>
      <h1 className="text-xl font-semibold">Pipeline</h1>
      {error ? <div className="mt-4 rounded border border-rose-800 bg-rose-950/40 p-3 text-sm">{error}</div> : null}
      {loading && !data ? <div className="mt-4 text-sm text-zinc-400">Loading…</div> : null}

      <div className="mt-6">
        <PipelineFunnel funnel={data?.funnel} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
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
                <div className="text-xs text-zinc-400">{f.updated_at}</div>
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
