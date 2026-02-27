'use client'

import { useState, useEffect, useCallback } from 'react'

const MONO = "'Courier New', monospace"
const BG = '#07090f'
const CARD_BG = '#0d1117'
const BORDER = '#1a2332'
const CYAN = '#00f0ff'
const GREEN = '#00ff9f'
const RED = '#ff3c6e'
const YELLOW = '#ffd700'
const PURPLE = '#bf7fff'
const DIM = '#4a5568'
const TEXT = '#c9d1d9'

function outcomeColor(outcome: string) {
  if (outcome === 'correct') return GREEN
  if (outcome === 'partial') return YELLOW
  if (outcome === 'incorrect') return RED
  return DIM
}

function scoreBar(score: number, color: string) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: '#1a2332', borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontFamily: MONO, fontSize: 11, color, minWidth: 32 }}>{pct}%</span>
    </div>
  )
}

function EpisodeCard({ ep, expanded, onToggle }: { ep: any; expanded: boolean; onToggle: () => void }) {
  const outcome = String(ep.outcome ?? 'unknown')
  const oColor = outcomeColor(outcome)
  const taskType = String(ep.task_type ?? '—')
  const desk = String(ep.desk ?? ep.agent_role ?? '—')
  const date = new Date(ep.created_at).toLocaleString()
  const reasoning = String(ep.reasoning ?? '')
  const reflection = String(ep.reflection ?? '')
  const lessons: string[] = Array.isArray(ep.lessons) ? ep.lessons : []
  const outcomeScore = Number(ep.outcome_score ?? 0)
  const reasoningScore = Number(ep.reasoning_score ?? 0)
  const errorType = ep.error_type ? String(ep.error_type) : null

  // Extract key info from task_input / action_taken
  const input = ep.task_input as any
  const action = ep.action_taken as any
  const symbol = input?.symbol ?? input?.ticker ?? input?.market_ticker ?? null
  const side = input?.side ?? action?.side ?? null
  const actionType = action?.type ?? null

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${expanded ? CYAN + '44' : BORDER}`, background: CARD_BG, marginBottom: 8, overflow: 'hidden', transition: 'border-color 0.2s' }}>
      {/* Header row */}
      <div
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}
      >
        {/* Outcome dot */}
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: oColor, flexShrink: 0, boxShadow: `0 0 6px ${oColor}` }} />

        {/* Task type */}
        <span style={{ fontFamily: MONO, fontSize: 12, color: CYAN, minWidth: 220 }}>{taskType}</span>

        {/* Symbol + side */}
        {symbol && (
          <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT, minWidth: 100 }}>
            {symbol}{side ? ` · ${String(side).toUpperCase()}` : ''}
          </span>
        )}

        {/* Desk */}
        <span style={{ fontFamily: MONO, fontSize: 10, color: DIM, flex: 1 }}>{desk}</span>

        {/* Scores */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', minWidth: 180 }}>
          <div style={{ minWidth: 80 }}>
            <div style={{ fontFamily: MONO, fontSize: 9, color: DIM, marginBottom: 2 }}>OUTCOME</div>
            {scoreBar(outcomeScore, oColor)}
          </div>
          <div style={{ minWidth: 80 }}>
            <div style={{ fontFamily: MONO, fontSize: 9, color: DIM, marginBottom: 2 }}>REASONING</div>
            {scoreBar(reasoningScore, PURPLE)}
          </div>
        </div>

        {/* Outcome label */}
        <span style={{ fontFamily: MONO, fontSize: 10, color: oColor, minWidth: 60, textAlign: 'right' }}>{outcome.toUpperCase()}</span>

        {/* Date */}
        <span style={{ fontFamily: MONO, fontSize: 10, color: DIM, minWidth: 140, textAlign: 'right' }}>{date}</span>

        {/* Chevron */}
        <span style={{ color: DIM, fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${BORDER}`, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Reasoning */}
          {reasoning && (
            <div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: CYAN, marginBottom: 6, letterSpacing: '0.1em' }}>◈ WHY THIS TRADE</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: TEXT, lineHeight: 1.7, background: '#0a0f1a', borderRadius: 6, padding: '10px 12px', border: `1px solid ${BORDER}`, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>
                {reasoning}
              </div>
            </div>
          )}

          {/* Action taken */}
          {action && (
            <div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: YELLOW, marginBottom: 6, letterSpacing: '0.1em' }}>◈ ACTION TAKEN</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: TEXT, background: '#0a0f1a', borderRadius: 6, padding: '10px 12px', border: `1px solid ${BORDER}`, whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>
                {JSON.stringify(action, null, 2)}
              </div>
            </div>
          )}

          {/* Reflection */}
          {reflection && (
            <div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: PURPLE, marginBottom: 6, letterSpacing: '0.1em' }}>◈ REFLECTION</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: TEXT, lineHeight: 1.7, background: '#0a0f1a', borderRadius: 6, padding: '10px 12px', border: `1px solid ${BORDER}`, whiteSpace: 'pre-wrap', maxHeight: 160, overflowY: 'auto' }}>
                {reflection}
              </div>
            </div>
          )}

          {/* Lessons */}
          {lessons.length > 0 && (
            <div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: GREEN, marginBottom: 6, letterSpacing: '0.1em' }}>◈ LESSONS LEARNED</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {lessons.map((l, i) => (
                  <div key={i} style={{ fontFamily: MONO, fontSize: 11, color: TEXT, background: '#0a0f1a', borderRadius: 4, padding: '6px 10px', border: `1px solid ${GREEN}22`, display: 'flex', gap: 8 }}>
                    <span style={{ color: GREEN }}>›</span>
                    <span style={{ lineHeight: 1.6 }}>{l}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error type if incorrect */}
          {errorType && (
            <div style={{ fontFamily: MONO, fontSize: 10, color: RED, padding: '6px 10px', border: `1px solid ${RED}44`, borderRadius: 4, background: `${RED}11` }}>
              ⚠ ERROR TYPE: {errorType.toUpperCase()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function IntelligencePage() {
  const [episodes, setEpisodes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'execution' | 'risk' | 'research' | 'incorrect'>('all')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/episodes?limit=100', { cache: 'no-store' })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error)
      setEpisodes(j.episodes)
      setLastUpdated(new Date())
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load episodes')
    } finally {
      setLoading(false)
    }
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

  // Stats
  const total = episodes.length
  const correct = episodes.filter(e => e.outcome === 'correct').length
  const partial = episodes.filter(e => e.outcome === 'partial').length
  const incorrect = episodes.filter(e => e.outcome === 'incorrect').length
  const avgOS = total ? (episodes.reduce((s, e) => s + Number(e.outcome_score ?? 0), 0) / total) : 0
  const avgRS = total ? (episodes.reduce((s, e) => s + Number(e.reasoning_score ?? 0), 0) / total) : 0

  const filters: { key: typeof filter; label: string; color: string }[] = [
    { key: 'all', label: 'ALL', color: CYAN },
    { key: 'execution', label: 'EXECUTION', color: GREEN },
    { key: 'risk', label: 'RISK', color: YELLOW },
    { key: 'research', label: 'RESEARCH', color: PURPLE },
    { key: 'incorrect', label: `ERRORS (${incorrect})`, color: RED },
  ]

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 28px', fontFamily: MONO, color: TEXT }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, color: CYAN, fontWeight: 700, letterSpacing: '0.15em' }}>◈ INTELLIGENCE FEED</div>
          <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>Reasoning · Decisions · Lessons · Reflection</div>
        </div>
        <div style={{ fontSize: 10, color: DIM }}>
          {lastUpdated ? `UPDATED ${lastUpdated.toLocaleTimeString()}` : 'LOADING...'}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'TOTAL', value: total, color: CYAN },
          { label: 'CORRECT', value: correct, color: GREEN },
          { label: 'PARTIAL', value: partial, color: YELLOW },
          { label: 'INCORRECT', value: incorrect, color: RED },
          { label: 'AVG OUTCOME', value: `${Math.round(avgOS * 100)}%`, color: outcomeColor(avgOS > 0.7 ? 'correct' : avgOS >= 0.5 ? 'partial' : 'incorrect') },
        ].map(s => (
          <div key={s.label} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 9, color: DIM, letterSpacing: '0.1em' }}>{s.label}</div>
            <div style={{ fontSize: 22, color: s.color, fontWeight: 700, marginTop: 2 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              fontFamily: MONO, fontSize: 10, padding: '5px 12px', borderRadius: 4, cursor: 'pointer', letterSpacing: '0.08em',
              background: filter === f.key ? `${f.color}22` : 'transparent',
              border: `1px solid ${filter === f.key ? f.color : BORDER}`,
              color: filter === f.key ? f.color : DIM,
              transition: 'all 0.15s',
            }}
          >
            {f.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 10, color: DIM, padding: '5px 0', alignSelf: 'center' }}>
          AVG REASONING {Math.round(avgRS * 100)}%
        </div>
      </div>

      {/* Error */}
      {error && <div style={{ color: RED, fontSize: 12, marginBottom: 12, padding: '8px 12px', border: `1px solid ${RED}44`, borderRadius: 6 }}>{error}</div>}

      {/* Loading */}
      {loading && <div style={{ color: DIM, fontSize: 12 }}>Loading episodes...</div>}

      {/* Episode list */}
      {!loading && filtered.length === 0 && (
        <div style={{ color: DIM, fontSize: 12, textAlign: 'center', padding: 40 }}>No episodes found for this filter.</div>
      )}

      {filtered.map(ep => (
        <EpisodeCard
          key={ep.id}
          ep={ep}
          expanded={expandedId === ep.id}
          onToggle={() => setExpandedId(expandedId === ep.id ? null : ep.id)}
        />
      ))}
    </div>
  )
}
