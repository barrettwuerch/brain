'use client'

import clsx from 'clsx'

type Props = {
  bot: any
}

function stateColor(state: string) {
  switch (state) {
    case 'exploiting':
      return 'bg-emerald-500'
    case 'cautious':
      return 'bg-amber-400'
    case 'paused':
      return 'bg-rose-500'
    case 'recovering':
      return 'bg-sky-500'
    case 'diagnostic':
      return 'bg-purple-500'
    default:
      return 'bg-zinc-500'
  }
}

function borderColor(state: string) {
  switch (state) {
    case 'exploiting':
      return 'border-emerald-500/30'
    case 'cautious':
      return 'border-amber-500/30'
    case 'paused':
      return 'border-rose-500/40'
    case 'recovering':
      return 'border-sky-500/30'
    case 'diagnostic':
      return 'border-purple-500/30'
    default:
      return 'border-zinc-800'
  }
}

function pulseClass(state: string) {
  if (state === 'paused' || state === 'diagnostic') return ''
  if (state === 'exploiting') return 'animate-pulse'
  return 'animate-pulse [animation-duration:2.5s]'
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

export function BotCard({ bot }: Props) {
  const state = String(bot.current_state ?? 'unknown').toLowerCase()
  const dot = stateColor(state)
  const pulse = pulseClass(state)
  const border = borderColor(state)

  const dd = Number(bot.current_drawdown ?? 0)

  return (
    <div className={clsx('rounded-xl border bg-zinc-900/40 p-4 border-l-4', border)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={clsx('h-3 w-3 rounded-full', dot, pulse)} />
          <div className="font-medium">{bot.bot_id}</div>
        </div>
        <div className="text-xs text-zinc-400">{bot.agent_role ?? bot.desk}</div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="text-sm text-zinc-300">{state.toUpperCase()}</div>
        {dd > 0 ? <div className="text-sm text-zinc-200">DD {(dd * 100).toFixed(1)}%</div> : null}
      </div>

      <div className="mt-2 text-xs text-zinc-300">
        Last task: <span className="text-zinc-100">{bot.last_task_type ?? '—'}</span>
      </div>
      <div className="mt-1 text-xs text-zinc-500">{timeAgo(bot.last_activity_at ?? null)}</div>

      {bot.reason ? (
        <div className="mt-2 text-xs text-zinc-400 line-clamp-2">{String(bot.reason)}</div>
      ) : null}
    </div>
  )
}
