'use client'

export function PipelineFunnel({ funnel }: { funnel: any }) {
  const steps = [
    { label: 'Noticed', value: Number(funnel?.noticed ?? 0), color: 'bg-zinc-600' },
    { label: 'Scored', value: Number(funnel?.scored ?? 0), color: 'bg-sky-600' },
    { label: 'Challenged', value: Number(funnel?.challenged ?? 0), color: 'bg-amber-600' },
    { label: 'Live', value: Number(funnel?.live ?? 0), color: 'bg-emerald-600' },
  ]

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="text-sm font-medium">Pipeline</div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {steps.map((s) => (
          <div key={s.label} className="rounded-lg border border-zinc-800 p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-zinc-400">{s.label}</div>
              <span className={`h-2 w-2 rounded-full ${s.color}`} />
            </div>
            <div className="mt-2 text-2xl font-semibold">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
