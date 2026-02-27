'use client'

import clsx from 'clsx'

export function ISScoreBar({ row }: { row: any }) {
  const raw = Number(row.value ?? 0)
  const v = Math.max(0, Math.min(1, raw))
  const color = v > 0.7 ? 'bg-emerald-500' : v >= 0.5 ? 'bg-amber-400' : 'bg-rose-500'

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{row.task_type}</div>
        <div className="text-xs text-zinc-400">raw {raw.toFixed(2)}</div>
      </div>
      <div className="mt-2 h-2 w-full rounded bg-zinc-800">
        <div className={clsx('h-2 rounded', color)} style={{ width: `${Math.round(v * 100)}%` }} />
      </div>
      <div className="mt-2 text-xs text-zinc-500">{new Date(row.created_at).toLocaleString()}</div>
    </div>
  )
}
