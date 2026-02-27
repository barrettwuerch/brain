'use client'

import Link from 'next/link'
import { useRegime } from '@/hooks/use-regime'
import { usePoll } from '@/hooks/use-poll'
import { RegimeBadge } from './regime-badge'
import { useState } from 'react'

function HealthDot({ minutes }: { minutes: number | null }) {
  const ok = minutes !== null && minutes < 10
  const cls = ok ? 'bg-emerald-500' : 'bg-rose-500'
  const label = minutes === null ? '—' : `${minutes}m ago`
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />
      <span className="hidden sm:inline text-xs text-zinc-400">{label}</span>
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

  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="w-full border-b border-zinc-800 bg-zinc-950/60 backdrop-blur relative">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/floor" className="font-semibold tracking-wide">
            BRAIN
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-6 text-sm text-zinc-300">
            <Link className="hover:text-white" href="/floor">Floor</Link>
            <Link className="hover:text-white" href="/scoreboard">Scoreboard</Link>
            <Link className="hover:text-white" href="/pipeline">Pipeline</Link>
            <Link className="hover:text-white" href="/brief">Brief</Link>
            <Link className="hover:text-white" href="/intelligence">Intelligence</Link>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden h-11 w-11 inline-flex items-center justify-center rounded-md border border-zinc-800 text-zinc-200"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            ☰
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="hidden sm:inline">
            <RegimeBadge regime={regime} />
          </span>
          <span className="sm:hidden">
            <RegimeBadge regime={regime} />
          </span>
          <HealthDot minutes={health?.minutesAgo ?? null} />
        </div>
      </div>

      {/* Mobile dropdown */}
      {menuOpen ? (
        <div className="md:hidden absolute top-full left-0 right-0 bg-zinc-900 border-b border-zinc-800 z-50">
          {['floor', 'scoreboard', 'pipeline', 'brief', 'intelligence'].map((screen) => (
            <Link
              key={screen}
              href={`/${screen}`}
              className="block px-6 py-4 text-sm capitalize border-b border-zinc-800"
              onClick={() => setMenuOpen(false)}
            >
              {screen}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
