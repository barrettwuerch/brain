'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRegime } from '@/hooks/use-regime'
import { usePoll } from '@/hooks/use-poll'

const PAGES = [
  { href: '/floor',        label: 'Floor' },
  { href: '/scoreboard',   label: 'Scoreboard' },
  { href: '/pipeline',     label: 'Pipeline' },
  { href: '/intelligence', label: 'Intelligence' },
]

function regimeColor(r: string) {
  if (r === 'low')      return '#00c896'
  if (r === 'normal')   return '#60a5fa'
  if (r === 'elevated') return '#f5a623'
  if (r === 'extreme')  return '#ff3c6e'
  return '#6b7280'
}

export function Nav() {
  const pathname = usePathname()
  const { data: regime } = useRegime()
  const { data: health } = usePoll(async () => {
    const res = await fetch('/api/loop-health', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok || !j.ok) throw new Error(j.error ?? 'loop-health failed')
    return j as any
  }, 5000)

  const minutesAgo = health?.minutesAgo ?? null
  const isHealthy = minutesAgo !== null && minutesAgo < 10
  const rColor = regimeColor(String(regime ?? 'unknown'))
  const rLabel = String(regime ?? '...').toUpperCase()

  return (
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

      {/* Desktop bar */}
      <div className="hide-on-mobile" style={{ padding: '0 20px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Link href="/floor" style={{ fontSize: 15, fontWeight: 700, color: '#f0f0f0', textDecoration: 'none', letterSpacing: '-0.3px' }}>
            BRAIN
          </Link>
          <div style={{ display: 'flex', gap: 2 }}>
            {PAGES.map(p => {
              const active = pathname === p.href
              return (
                <Link key={p.href} href={p.href} style={{
                  fontSize: 13, fontWeight: 500, padding: '5px 12px', borderRadius: 6,
                  textDecoration: 'none',
                  color: active ? '#f0f0f0' : 'rgba(255,255,255,0.4)',
                  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                }}>
                  {p.label}
                </Link>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: `${rColor}18`, border: `1px solid ${rColor}44` }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: rColor, boxShadow: `0 0 6px ${rColor}` }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: rColor }}>{rLabel}</span>
          </div>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: isHealthy ? '#00c896' : '#ff3c6e', boxShadow: isHealthy ? '0 0 8px #00c896' : 'none' }} />
        </div>
      </div>

      {/* Mobile: status strip + tab bar */}
      <div className="show-on-mobile">
        <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#f0f0f0', letterSpacing: '-0.3px' }}>BRAIN</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 12, background: `${rColor}18`, border: `1px solid ${rColor}44` }}>
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: rColor, boxShadow: `0 0 5px ${rColor}` }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: rColor }}>{rLabel}</span>
            </div>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: isHealthy ? '#00c896' : '#ff3c6e', boxShadow: isHealthy ? '0 0 8px #00c896' : 'none' }} />
          </div>
        </div>
        <div style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {PAGES.map(p => {
            const active = pathname === p.href
            return (
              <Link key={p.href} href={p.href} style={{
                flexShrink: 0, flex: 1, textAlign: 'center',
                padding: '11px 0', fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? '#f0f0f0' : 'rgba(255,255,255,0.35)',
                textDecoration: 'none',
                borderBottom: active ? '2px solid #00e5ff' : '2px solid transparent',
              }}>
                {p.label}
              </Link>
            )
          })}
        </div>
      </div>

    </div>
  )
}
