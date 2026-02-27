'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRegime } from '@/hooks/use-regime'
import { usePoll } from '@/hooks/use-poll'
import { useState } from 'react'

const PAGES = [
  { href: '/floor', label: 'Floor' },
  { href: '/scoreboard', label: 'Scoreboard' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/intelligence', label: 'Intelligence' },
]

function regimeColor(r: string) {
  if (r === 'low') return '#00c896'
  if (r === 'normal') return '#60a5fa'
  if (r === 'elevated') return '#f5a623'
  if (r === 'extreme') return '#ff3c6e'
  return '#6b7280'
}

export function Nav() {
  const pathname = usePathname()
  const { data: regime } = useRegime()
  const [menuOpen, setMenuOpen] = useState(false)

  const { data: health } = usePoll(async () => {
    const res = await fetch('/api/loop-health', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok || !j.ok) throw new Error(j.error ?? 'loop-health failed')
    return j as any
  }, 5000)

  const minutesAgo = health?.minutesAgo ?? null
  const isHealthy = minutesAgo !== null && minutesAgo < 10
  const rColor = regimeColor(String(regime ?? 'unknown'))
  const rLabel = String(regime ?? 'unknown').toUpperCase()

  return (
    <>
      {/* Nav bar */}
      <div style={{
        width: '100%',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(7,9,15,0.97)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
      }}>
        <div style={{ padding: '0 20px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Left */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <Link href="/floor" style={{ fontSize: 15, fontWeight: 700, color: '#f0f0f0', textDecoration: 'none', letterSpacing: '-0.3px' }}>
              BRAIN
            </Link>

            {/* Desktop links */}
            <div style={{ display: 'flex', gap: 4 }} className="hide-on-mobile">
              {PAGES.map(p => {
                const active = pathname === p.href
                return (
                  <Link key={p.href} href={p.href} style={{
                    fontSize: 13, fontWeight: 500, padding: '5px 12px', borderRadius: 6,
                    textDecoration: 'none',
                    color: active ? '#f0f0f0' : 'rgba(255,255,255,0.4)',
                    background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                    transition: 'all 0.15s',
                  }}>
                    {p.label}
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Right */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Regime */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: `${rColor}18`, border: `1px solid ${rColor}44` }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: rColor, boxShadow: `0 0 6px ${rColor}` }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: rColor }}>{rLabel}</span>
            </div>

            {/* Health */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: isHealthy ? '#00c896' : '#ff3c6e', boxShadow: isHealthy ? '0 0 8px #00c896' : 'none' }} />
            </div>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="show-on-mobile"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', width: 34, height: 34, borderRadius: 8, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {menuOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown — fixed, above everything */}
      {menuOpen && (
        <div style={{
          position: 'fixed', top: 52, left: 0, right: 0,
          background: 'rgba(7,9,15,0.99)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          zIndex: 99999,
          backdropFilter: 'blur(20px)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
        }}>
          {PAGES.map(p => (
            <Link key={p.href} href={p.href}
              onClick={() => setMenuOpen(false)}
              style={{
                display: 'block', padding: '16px 24px',
                fontSize: 15, fontWeight: 500,
                color: pathname === p.href ? '#f0f0f0' : 'rgba(255,255,255,0.5)',
                textDecoration: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                background: pathname === p.href ? 'rgba(255,255,255,0.04)' : 'transparent',
              }}>
              {p.label}
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
