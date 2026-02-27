'use client'

import { useState, useEffect, useCallback } from 'react'

const FONT = "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif"
const MONO = "'Courier New', monospace"
const BG = '#07090f'
const CARD = '#0d1117'
const BORDER = 'rgba(255,255,255,0.06)'
const GREEN = '#00c896'
const RED = '#ff3c6e'
const YELLOW = '#f5a623'
const BLUE = '#60a5fa'
const PURPLE = '#a78bfa'
const DIM = '#6b7280'
const TEXT = '#f0f0f0'
const SUBTEXT = '#9ca3af'

function outcomeColor(outcome: string) {
  if (outcome === 'correct') return GREEN
  if (outcome === 'partial') return YELLOW
  if (outcome === 'incorrect') return RED
  return DIM
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, color, minWidth: 28, textAlign: 'right', fontFamily: MONO }}>{pct}%</span>
    </div>
  )
}

function EpisodeCard({ ep, expanded, onToggle }: { ep: any; expanded: boolean; onToggle: () => void }) {
  const outcome = String(ep.outcome ?? 'unknown')
  const oColor = outcomeColor(outcome)
  const taskType = String(ep.task_type ?? '—').replace(/_/g, ' ')
  const outcomeScore = Number(ep.outcome_score ?? 0)
  const reasoningScore = Number(ep.reasoning_score ?? 0)
  const reasoning = String(ep.reasoning ?? '')
  const reflection = String(ep.reflection ?? '')
  const lessons: string[] = Array.isArray(ep.lessons) ? ep.lessons : []
  const errorType = ep.error_type ? String(ep.error_type) : null
  const input = ep.task_input as any
  const action = ep.action_taken as any
  const symbol = input?.symbol ?? input?.ticker ?? input?.market_ticker ?? null
  const side = input?.side ?? action?.side ?? null
  const isBuy = String(side) === 'buy' || String(side) === 'yes'

  const now = new Date()
  const d = new Date(ep.created_at)
  const diff = now.getTime() - d.getTime()
  const timeStr = diff < 3600000 ? `${Math.floor(diff / 60000)}m ago` : diff < 86400000 ? `${Math.floor(diff / 3600000)}h ago` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div style={{ border: `1px solid ${expanded ? 'rgba(255,255,255,0.12)' : BORDER}`, borderRadius: 12, background: CARD, marginBottom: 6, overflow: 'hidden', transition: 'border-color 0.2s' }}>
      {/* Header */}
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer', userSelect: 'none' }}>
        {/* Outcome dot */}
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: oColor, flexShrink: 0, boxShadow: `0 0 8px ${oColor}66` }} />

        {/* Task + symbol */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: TEXT, textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {taskType}
            {symbol && <span style={{ color: SUBTEXT, fontWeight: 400, marginLeft: 8 }}>· {symbol}{side ? ` · ${isBuy ? 'BUY' : 'SELL'}` : ''}</span>}
          </div>
          <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>{String(ep.desk ?? ep.agent_role ?? '—')}</div>
        </div>

        {/* Score bars — hide on mobile */}
        <div style={{ display: 'flex', gap: 16, minWidth: 200 }} className="hide-on-mobile">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: DIM, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Outcome</div>
            <ScoreBar score={outcomeScore} color={oColor} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: DIM, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Reasoning</div>
            <ScoreBar score={reasoningScore} color={PURPLE} />
          </div>
        </div>

        {/* Outcome pill */}
        <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: `${oColor}18`, color: oColor, flexShrink: 0 }}>
          {outcome.charAt(0).toUpperCase() + outcome.slice(1)}
        </span>

        {/* Time */}
        <span style={{ fontSize: 11, color: DIM, flexShrink: 0, minWidth: 50, textAlign: 'right' }}>{timeStr}</span>

        <span style={{ color: DIM, fontSize: 12, flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${BORDER}`, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {reasoning && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: BLUE, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Why this trade</div>
              <div style={{ fontSize: 12, color: SUBTEXT, lineHeight: 1.8, background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '12px 14px', border: `1px solid ${BORDER}`, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto', fontFamily: MONO }}>
                {reasoning}
              </div>
            </div>
          )}

          {action && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: YELLOW, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Action taken</div>
              <div style={{ fontSize: 12, color: SUBTEXT, background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '12px 14px', border: `1px solid ${BORDER}`, whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto', fontFamily: MONO }}>
                {JSON.stringify(action, null, 2)}
              </div>
            </div>
          )}

          {reflection && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: PURPLE, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Reflection</div>
              <div style={{ fontSize: 12, color: SUBTEXT, lineHeight: 1.8, background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '12px 14px', border: `1px solid ${BORDER}`, whiteSpace: 'pre-wrap', maxHeight: 160, overflowY: 'auto', fontFamily: MONO }}>
                {reflection}
              </div>
            </div>
          )}

          {lessons.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: GREEN, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Lessons learned</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {lessons.map((l, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: `1px solid ${BORDER}` }}>
                    <span style={{ color: GREEN, flexShrink: 0, marginTop: 1 }}>›</span>
                    <span style={{ fontSize: 12, color: SUBTEXT, lineHeight: 1.6 }}>{l}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {errorType && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: `1px solid ${RED}33`, borderRadius: 8, background: `${RED}0a` }}>
              <span style={{ color: RED }}>⚠</span>
              <span style={{ fontSize: 12, color: RED }}>Error: {errorType}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const FILTERS = [
  { key: 'all',       label: 'All',       color: TEXT },
  { key: 'execution', label: 'Execution', color: YELLOW },
  { key: 'risk',      label: 'Risk',      color: RED },
  { key: 'research',  label: 'Research',  color: BLUE },
  { key: 'incorrect', label: 'Errors',    color: RED },
] as const

type FilterKey = typeof FILTERS[number]['key']

export default function IntelligencePage() {
  const [episodes, setEpisodes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/episodes?limit=100', { cache: 'no-store' })
      const j = await res.json()
      if (j.ok) setEpisodes(j.episodes)
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const filtered = episodes.filter(ep => {
    if (filter === 'all') return true
    if (filter === 'execution') return ep.agent_role === 'execution'
    if (filter === 'risk') return ep.agent_role === 'risk'
    if (filter === 'research') return ep.agent_role === 'strategy' || ep.agent_role === 'research'
    if (filter === 'incorrect') return ep.outcome === 'incorrect'
    return true
  })

  const total = episodes.length
  const correct = episodes.filter(e => e.outcome === 'correct').length
  const incorrect = episodes.filter(e => e.outcome === 'incorrect').length
  const avgOS = total ? episodes.reduce((s, e) => s + Number(e.outcome_score ?? 0), 0) / total : 0

  return (
    <div style={{ background: BG, minHeight: '100vh', fontFamily: FONT, color: TEXT, paddingBottom: 40 }}>
      <style>{`
        @media (max-width: 640px) {
          .int-stats { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 768px) {
          .hide-on-mobile { display: none !important; }
        }
      `}</style>

      {/* Header */}
      <div style={{ padding: '28px 24px 20px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ fontSize: 11, color: DIM, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6, fontFamily: MONO }}>Intelligence</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: TEXT, letterSpacing: -0.5 }}>Decision Feed</div>
      </div>

      {/* Stats */}
      <div className="int-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, borderBottom: `1px solid ${BORDER}`, background: BORDER }}>
        {[
          { label: 'Episodes', value: total, color: TEXT },
          { label: 'Correct', value: correct, color: GREEN },
          { label: 'Incorrect', value: incorrect, color: RED },
          { label: 'Avg Score', value: `${Math.round(avgOS * 100)}%`, color: outcomeColor(avgOS > 0.7 ? 'correct' : avgOS >= 0.5 ? 'partial' : 'incorrect') },
        ].map(s => (
          <div key={s.label} style={{ background: CARD, padding: '16px 20px' }}>
            <div style={{ fontSize: 10, color: DIM, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '20px 24px 0' }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
              background: filter === f.key ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: `1px solid ${filter === f.key ? 'rgba(255,255,255,0.2)' : BORDER}`,
              color: filter === f.key ? TEXT : DIM,
              transition: 'all 0.15s',
              fontFamily: FONT,
            }}>
              {f.label}
              {f.key === 'incorrect' && incorrect > 0 && (
                <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 10, background: `${RED}33`, color: RED, fontSize: 10 }}>{incorrect}</span>
              )}
            </button>
          ))}
        </div>

        {/* List */}
        {loading && <div style={{ fontSize: 12, color: DIM, padding: '24px 0' }}>Loading episodes...</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', fontSize: 13, color: DIM }}>No episodes for this filter.</div>
        )}
        {filtered.map(ep => (
          <EpisodeCard key={ep.id} ep={ep} expanded={expandedId === ep.id} onToggle={() => setExpandedId(expandedId === ep.id ? null : ep.id)} />
        ))}
      </div>
    </div>
  )
}
