'use client'

import { BotCard } from '@/components/bot-card'
import { useBotStates } from '@/hooks/use-bot-states'

export default function FloorPage() {
  const { data: bots, loading, error } = useBotStates()

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Trading Floor</h1>
        <div className="text-sm text-zinc-400">Polling: 5s</div>
      </div>

      {error ? <div className="mt-4 rounded border border-rose-800 bg-rose-950/40 p-3 text-sm">{error}</div> : null}
      {loading && !bots ? <div className="mt-4 text-sm text-zinc-400">Loading…</div> : null}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(bots ?? []).map((b: any) => (
          <BotCard key={b.bot_id} bot={b} />
        ))}
      </div>
    </div>
  )
}
