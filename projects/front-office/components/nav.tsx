'use client'

import Link from 'next/link'
import { useRegime } from '@/hooks/use-regime'
import { usePoll } from '@/hooks/use-poll'
import { RegimeBadge } from './regime-badge'

function HealthDot({ minutes }: { minutes: number | null }) {
  const ok = minutes !== null && minutes < 10
  const cls = ok ? 'bg-emerald-500' : 'bg-rose-500'
  const label = minutes === null ? '—' : `${minutes}m ago`
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />
      <span className="text-xs text-zinc-400">{label}</span>
    </div>
  )
}

export function Nav() {
  const { data: regime } = useRegime()
  const { data: health } = usePoll(async () => {
    const res = await fetch('/api/loop-health', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok || !j.ok) throw new Error(j.error ?? 'loop-health failed')
    return j as any
  }, 5000)

  return (
    <div className="w-full border-b border-zinc-800 bg-zinc-950/60 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/floor" className="font-semibold tracking-wide">
            BRAIN
          </Link>
          <div className="flex items-center gap-3 text-sm text-zinc-300">
            <Link className="hover:text-white" href="/floor">Floor</Link>
            <Link className="hover:text-white" href="/scoreboard">Scoreboard</Link>
            <Link className="hover:text-white" href="/pipeline">Pipeline</Link>
            <Link className="hover:text-white" href="/brief">Brief</Link>
            <Link className="hover:text-white" href="/intelligence">Intelligence</Link>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <RegimeBadge regime={regime} />
          <HealthDot minutes={health?.minutesAgo ?? null} />
        </div>
      </div>
    </div>
  )
}
