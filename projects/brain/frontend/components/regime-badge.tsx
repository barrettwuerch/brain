import clsx from 'clsx'

export function RegimeBadge({ regime }: { regime: any }) {
  const r = String(regime?.value?.vol_regime ?? regime?.value ?? 'unknown').toUpperCase()
  const color =
    r === 'LOW' ? 'bg-emerald-600/20 text-emerald-200 border-emerald-500/30' :
    r === 'NORMAL' ? 'bg-sky-600/20 text-sky-200 border-sky-500/30' :
    r === 'ELEVATED' ? 'bg-amber-600/20 text-amber-200 border-amber-500/30' :
    r === 'EXTREME' ? 'bg-rose-600/20 text-rose-200 border-rose-500/30' :
    'bg-zinc-600/20 text-zinc-200 border-zinc-500/30'

  return (
    <span className={clsx('px-2 py-1 rounded-md border text-xs font-medium', color)}>
      {r}
    </span>
  )
}
