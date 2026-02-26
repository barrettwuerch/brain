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

export function BotCard({ bot }: Props) {
  const state = String(bot.current_state ?? 'unknown').toLowerCase()
  const dot = stateColor(state)
  const pulse = state === 'exploiting' ? 'animate-pulse' : ''

  const dd = Number(bot.current_drawdown ?? 0)

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={clsx('h-3 w-3 rounded-full', dot, pulse)} />
          <div className="font-medium">{bot.bot_id}</div>
        </div>
        <div className="text-xs text-zinc-400">{bot.desk}</div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="text-sm text-zinc-300">{state.toUpperCase()}</div>
        {dd > 0 ? <div className="text-sm text-zinc-200">DD {(dd * 100).toFixed(1)}%</div> : null}
      </div>

      {bot.reason ? (
        <div className="mt-2 text-xs text-zinc-400 line-clamp-3">{String(bot.reason)}</div>
      ) : null}

      <div className="mt-3 text-xs text-zinc-500">Updated {new Date(bot.updated_at).toLocaleString()}</div>
    </div>
  )
}
