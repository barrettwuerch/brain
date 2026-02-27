'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'

// ─── CANVAS ───────────────────────────────────────────────────────
const CW = 780, CH = 560
const TW = 60, TH = 30
const OX = CW * 0.47, OY = 70
function sc(c: number, r: number) {
  return { x: OX + ((c - r) * TW) / 2, y: OY + ((c + r) * TH) / 2 }
}

const P = {
  bg: '#07090f', fl0: '#0c1422', fl1: '#101928',
  wT: '#13203a', wL: '#0a1628', wR: '#0d1c32',
  dT: '#1b3526', dL: '#112218', dR: '#152c1e',
  ptT: '#1a3c10', ptL: '#112608', ptR: '#162e0c',
}

const BOTS = [
  { id: 'cos',       dbId: 'cos-bot-1',              label: 'Chief of Staff',   e: '👑', hex: '#f472b6', c: 4, r: 0, isCoS: true },
  { id: 'research',  dbId: 'research-bot-1',         label: 'Research',         e: '🔬', hex: '#22d3ee', c: 1, r: 2 },
  { id: 'strategy',  dbId: 'strategy-bot-1',         label: 'Strategy',         e: '♟',  hex: '#a78bfa', c: 4, r: 2 },
  { id: 'risk',      dbId: 'risk-bot-1',             label: 'Risk',             e: '⚠',  hex: '#f87171', c: 7, r: 2 },
  { id: 'execution', dbId: 'crypto-execution-bot-1', label: 'Execution',        e: '⚡', hex: '#fbbf24', c: 1, r: 6 },
  { id: 'intel',     dbId: 'intelligence-bot-1',     label: 'Intelligence',     e: '🦉', hex: '#34d399', c: 4, r: 6 },
  { id: 'orch',      dbId: 'orchestrator-1',         label: 'Orchestrator',     e: '🎯', hex: '#e879f9', c: 7, r: 6 },
  { id: 'scanner',   dbId: 'scanner-bot-1',          label: 'Scanner',          e: '📡', hex: '#fb923c', c: 4, r: 9 },
]

const DB_TO_BOT: Record<string, string> = Object.fromEntries(BOTS.map(b => [b.dbId, b.id]))
const EXTRA_MAP: Record<string, string> = {
  'execution-bot-1': 'execution',
  'crypto-research-bot-1': 'research',
  'crypto-strategy-bot-1': 'strategy',
  'scanner-bot-1': 'scanner',
}
function resolveBotId(dbId: string): string | null {
  return DB_TO_BOT[dbId] ?? EXTRA_MAP[dbId] ?? null
}

const TASK_MESSAGES: Record<string, string> = {
  place_limit_order:              '⚡ Order placed ✓',
  place_crypto_limit_order:       '⚡ Crypto order placed ✓',
  manage_open_position:           '📍 Managing position',
  manage_crypto_position:         '📍 Position check',
  size_position:                  '💰 Sizing position...',
  evaluate_circuit_breakers:      '🚨 Checking breakers',
  monitor_positions:              '📊 Monitoring',
  check_drawdown_limit:           '⚠ Drawdown check',
  publish_regime_state:           '📡 Regime published',
  market_trend_scan:              '🔍 Scanning trends...',
  crypto_trend_scan:              '🔍 BTC trend scan',
  volume_anomaly_detect:          '📊 Vol anomaly check',
  price_momentum_classify:        '📈 Momentum classified',
  funding_rate_scan:              '💸 Funding rate check',
  volatility_regime_detect:       '🌡 Vol regime detected',
  correlation_scan:               '🔗 Correlation scan',
  run_backtest:                   '📋 Backtest running...',
  run_crypto_backtest:            '📋 Crypto backtest...',
  challenge_strategy:             '⚔ Challenging strategy',
  formalize_strategy:             '♟ Formalizing edge...',
  route_research_findings:        '🎯 Routing findings',
  review_bot_states:              '🔄 Reviewing states',
  generate_priority_map:          '🗺 Priority map updated',
  register_watch_conditions:      '✅ Watch conditions set',
  assess_strategic_priorities:    '👑 Setting priorities',
  generate_daily_brief:           '📋 Brief ready',
  generate_weekly_memo:           '📝 Memo done',
  detect_systematic_blind_spots:  '🔍 Blind spot scan',
  evaluate_bottlenecks:           '⚙ Bottleneck review',
  consolidate_memories:           '🦉 Consolidating...',
  attribute_performance:          '📊 Attribution done',
  generate_daily_report:          '📝 Report ready',
  loop_heartbeat:                 '💓 Heartbeat',
  validate_edge_mechanism:        '🔬 Validating edge',
  generate_next_generation_hypothesis: '✨ New hypothesis!',
}

const REGIMES: Record<string, any> = {
  low:      { label: 'Low Vol',      color: '#00c896', bg: 'rgba(0,200,150,0.1)',    border: 'rgba(0,200,150,0.3)' },
  normal:   { label: 'Normal',       color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',   border: 'rgba(96,165,250,0.3)' },
  elevated: { label: 'Elevated Vol', color: '#f5a623', bg: 'rgba(245,166,35,0.1)',   border: 'rgba(245,166,35,0.3)' },
  extreme:  { label: 'Extreme Vol',  color: '#ff3c6e', bg: 'rgba(255,60,110,0.1)',   border: 'rgba(255,60,110,0.3)' },
}

const SS: Record<string, any> = {
  exploiting: { fg: '#4ade80', bd: '#22c55e', bg: 'rgba(34,197,94,0.1)',   lb: 'EXPLOITING' },
  cautious:   { fg: '#fde047', bd: '#eab308', bg: 'rgba(234,179,8,0.1)',   lb: 'CAUTIOUS'   },
  paused:     { fg: '#fca5a5', bd: '#ef4444', bg: 'rgba(239,68,68,0.1)',   lb: 'PAUSED'     },
  recovering: { fg: '#93c5fd', bd: '#3b82f6', bg: 'rgba(59,130,246,0.1)', lb: 'RECOVERING' },
  diagnostic: { fg: '#d8b4fe', bd: '#a855f7', bg: 'rgba(168,85,247,0.1)', lb: 'DIAGNOSTIC' },
}

// ─── DRAWING ──────────────────────────────────────────────────────
function hexRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function lx(hex: string, n: number = 40) {
  const [r, g, b] = hexRgb(hex)
  return `rgb(${Math.min(255, r + n)},${Math.min(255, g + n)},${Math.min(255, b + n)})`
}
function drawTile(ctx: CanvasRenderingContext2D, c: number, r: number, fill: string) {
  const { x, y } = sc(c, r)
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + TW / 2, y + TH / 2); ctx.lineTo(x, y + TH); ctx.lineTo(x - TW / 2, y + TH / 2); ctx.closePath()
  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 0.5; ctx.stroke()
}
function drawCube(ctx: CanvasRenderingContext2D, c: number, r: number, h: number, top: string, left: string, right: string) {
  const { x, y } = sc(c, r); const ty = y - h
  ctx.beginPath(); ctx.moveTo(x, ty); ctx.lineTo(x + TW / 2, ty + TH / 2); ctx.lineTo(x, ty + TH); ctx.lineTo(x - TW / 2, ty + TH / 2); ctx.closePath()
  ctx.fillStyle = top; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.5; ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x - TW / 2, ty + TH / 2); ctx.lineTo(x, ty + TH); ctx.lineTo(x, y + TH); ctx.lineTo(x - TW / 2, y + TH / 2); ctx.closePath()
  ctx.fillStyle = left; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x + TW / 2, ty + TH / 2); ctx.lineTo(x, ty + TH); ctx.lineTo(x, y + TH); ctx.lineTo(x + TW / 2, y + TH / 2); ctx.closePath()
  ctx.fillStyle = right; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke()
}
function drawMonitor(ctx: CanvasRenderingContext2D, c: number, r: number, hex: string, t: number, active: boolean) {
  const { x, y } = sc(c, r); const mx = x + 4, my = y - 34
  const glow = active ? 0.5 + 0.3 * Math.abs(Math.sin(t * 0.006)) : 0.25
  const [rr, gg, bb] = hexRgb(hex)
  ctx.fillStyle = '#080e18'; ctx.fillRect(mx - 13, my - 12, 26, 18)
  ctx.strokeStyle = '#1e2d42'; ctx.lineWidth = 1; ctx.strokeRect(mx - 13, my - 12, 26, 18)
  ctx.fillStyle = `rgba(${rr},${gg},${bb},${glow * 0.35})`; ctx.fillRect(mx - 11, my - 10, 22, 14)
  for (let i = 0; i < 14; i += 2) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(mx - 11, my - 10 + i, 22, 1) }
  if (active) {
    ctx.fillStyle = `rgba(${rr},${gg},${bb},0.9)`
    for (let i = 0; i < 3; i++) { const w = 8 + Math.floor((Math.sin(t * 0.01 + i * 2) + 1) * 5); ctx.fillRect(mx - 10, my - 8 + i * 4, w, 2) }
  }
  ctx.fillStyle = '#111a2a'; ctx.fillRect(mx - 3, my + 6, 6, 5); ctx.fillRect(mx - 6, my + 11, 12, 3)
}
function drawBotSprite(ctx: CanvasRenderingContext2D, bx: number, by: number, hex: string, state: string, t: number, active: boolean, selected: boolean) {
  const bob = Math.sin(t * (active ? 0.08 : 0.035)) * (active ? 3 : 1.5); const y = by + bob
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(bx, by + 10, 12, 4, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#293548'; const ls = active ? Math.sin(t * 0.12) * 2 : 0
  ctx.fillRect(bx - 7, y + 7, 5, 7 + ls); ctx.fillRect(bx + 2, y + 7, 5, 7 - ls)
  ctx.fillStyle = hex; ctx.fillRect(bx - 9, y - 8, 18, 16)
  const arm = active ? Math.sin(t * 0.1) * 7 : 0; ctx.fillStyle = lx(hex, -25)
  ctx.fillRect(bx - 14, y - 6 + arm, 5, 11); ctx.fillRect(bx + 9, y - 6 - arm, 5, 11)
  ctx.fillStyle = lx(hex, 35); ctx.fillRect(bx - 7, y - 22, 14, 14)
  ctx.fillStyle = selected ? '#ffffff' : '#0f172a'; ctx.fillRect(bx - 5, y - 19, 3, 3); ctx.fillRect(bx + 2, y - 19, 3, 3)
  ctx.fillStyle = '#0f172a'
  if (state === 'paused') { ctx.fillRect(bx - 3, y - 11, 7, 2) }
  else if (state === 'cautious') { ctx.fillRect(bx - 3, y - 10, 2, 2); ctx.fillRect(bx + 1, y - 10, 2, 2) }
  else { ctx.fillRect(bx - 3, y - 12, 2, 2); ctx.fillRect(bx + 1, y - 12, 2, 2); ctx.fillRect(bx - 1, y - 11, 3, 1) }
  ctx.fillStyle = SS[state]?.bd ?? '#22c55e'; ctx.shadowColor = SS[state]?.bd ?? '#22c55e'; ctx.shadowBlur = 8
  ctx.beginPath(); ctx.arc(bx + 9, y - 25, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
  if (selected) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.strokeRect(bx - 11, y - 24, 22, 38); ctx.setLineDash([]) }
}
function drawCosSprite(ctx: CanvasRenderingContext2D, bx: number, by: number, hex: string, state: string, t: number, active: boolean, selected: boolean) {
  const bob = Math.sin(t * (active ? 0.08 : 0.035)) * (active ? 3 : 1.5); const y = by + bob
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(bx, by + 10, 16, 5, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#293548'; const ls = active ? Math.sin(t * 0.12) * 2 : 0
  ctx.fillRect(bx - 7, y + 7, 5, 7 + ls); ctx.fillRect(bx + 2, y + 7, 5, 7 - ls)
  ctx.fillStyle = hex; ctx.fillRect(bx - 10, y - 9, 20, 17)
  ctx.fillStyle = lx(hex, -30); ctx.beginPath(); ctx.moveTo(bx - 4, y - 9); ctx.lineTo(bx, y - 3); ctx.lineTo(bx + 4, y - 9); ctx.closePath(); ctx.fill()
  const arm = active ? Math.sin(t * 0.1) * 7 : 0; ctx.fillStyle = lx(hex, -25)
  ctx.fillRect(bx - 16, y - 7 + arm, 6, 12); ctx.fillRect(bx + 10, y - 7 - arm, 6, 12)
  ctx.fillStyle = lx(hex, 35); ctx.fillRect(bx - 8, y - 24, 16, 15)
  ctx.fillStyle = selected ? '#ffffff' : '#0f172a'; ctx.fillRect(bx - 6, y - 21, 4, 3); ctx.fillRect(bx + 2, y - 21, 4, 3)
  ctx.fillStyle = '#0f172a'; ctx.fillRect(bx - 4, y - 13, 2, 2); ctx.fillRect(bx, y - 13, 2, 2); ctx.fillRect(bx - 2, y - 12, 4, 1)
  const crownGlow = 0.7 + 0.3 * Math.abs(Math.sin(t * 0.004))
  ctx.fillStyle = `rgba(255,220,50,${crownGlow})`; ctx.shadowColor = 'rgba(255,200,0,0.8)'; ctx.shadowBlur = 10
  ctx.fillRect(bx - 8, y - 33, 16, 4)
  ctx.beginPath(); ctx.moveTo(bx - 8, y - 33); ctx.lineTo(bx - 8, y - 40); ctx.lineTo(bx - 4, y - 35); ctx.lineTo(bx, y - 42); ctx.lineTo(bx + 4, y - 35); ctx.lineTo(bx + 8, y - 40); ctx.lineTo(bx + 8, y - 33); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0
  ctx.fillStyle = SS[state]?.bd ?? '#22c55e'; ctx.shadowColor = SS[state]?.bd ?? '#22c55e'; ctx.shadowBlur = 10
  ctx.beginPath(); ctx.arc(bx + 11, y - 27, 5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
  if (selected) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.strokeRect(bx - 13, y - 44, 26, 58); ctx.setLineDash([]) }
}

function drawScene(ctx: CanvasRenderingContext2D, t: number, stR: Record<string, string>, actR: Record<string, boolean>, selR: string | null) {
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, CW, CH)
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) drawTile(ctx, c, r, (c + r) % 2 === 0 ? P.fl0 : P.fl1)
  for (let c = 0; c < 10; c++) drawCube(ctx, c, -1, 28, P.wT, P.wL, P.wR)
  const ws = sc(5, -1)
  ctx.fillStyle = '#0a0f1c'; ctx.fillRect(ws.x - 50, ws.y - 52, 100, 38)
  ctx.strokeStyle = '#1e3a5f'; ctx.lineWidth = 1; ctx.strokeRect(ws.x - 50, ws.y - 52, 100, 38)
  ctx.fillStyle = 'rgba(34,100,220,0.15)'; ctx.fillRect(ws.x - 48, ws.y - 50, 96, 34)
  ctx.font = 'bold 8px monospace'; ctx.fillStyle = '#3b82f6'; ctx.textAlign = 'center'; ctx.fillText('THE BRAIN — LIVE', ws.x, ws.y - 38)
  ctx.fillStyle = '#22c55e'; ctx.fillText('ALL SYSTEMS OPERATIONAL', ws.x, ws.y - 27)
  ctx.fillStyle = '#f472b6'; ctx.font = '7px monospace'; ctx.fillText('CoS: ALL CLEAR · SIMULATION RUNNING', ws.x, ws.y - 17)
  drawCube(ctx, 0, 0, 22, P.ptT, P.ptL, P.ptR); drawCube(ctx, 9, 0, 22, P.ptT, P.ptL, P.ptR)
  const sorted = [...BOTS].sort((a: any, b: any) => a.r + a.c - (b.r + b.c))
  for (const bot of sorted) {
    const state = stR[bot.id] || 'exploiting'; const isActive = actR[bot.id] || false; const isSel = selR === bot.id
    if (isActive) {
      const { x, y } = sc(bot.c, bot.r); const [rr, gg, bb] = hexRgb(bot.hex)
      const g = ctx.createRadialGradient(x, y + TH, 0, x, y + TH, 45)
      g.addColorStop(0, `rgba(${rr},${gg},${bb},0.18)`); g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y + TH, 45, 18, 0, 0, Math.PI * 2); ctx.fill()
    }
    drawCube(ctx, bot.c, bot.r, 16, P.dT, P.dL, P.dR)
    drawMonitor(ctx, bot.c, bot.r, bot.hex, t, isActive)
    const { x, y } = sc(bot.c, bot.r + 0.6)
    if ((bot as any).isCoS) drawCosSprite(ctx, x, y - 10, bot.hex, state, t, isActive, isSel)
    else drawBotSprite(ctx, x, y - 10, bot.hex, state, t, isActive, isSel)
  }
  const vg = ctx.createRadialGradient(CW / 2, CH / 2, CH * 0.3, CW / 2, CH / 2, CH * 0.85)
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)')
  ctx.fillStyle = vg; ctx.fillRect(0, 0, CW, CH)
  for (let i = 0; i < CH; i += 3) { ctx.fillStyle = 'rgba(0,0,0,0.04)'; ctx.fillRect(0, i, CW, 1) }
}

// ─── COMPONENT ────────────────────────────────────────────────────
export default function TradingOffice() {
  const cvs = useRef<HTMLCanvasElement | null>(null)
  const raf = useRef<number | null>(null)
  const statesRef = useRef<Record<string, string>>({})
  const activeRef = useRef<Record<string, boolean>>({})
  const selRef = useRef<string | null>(null)
  const prevEpisodeIdsRef = useRef<Set<string>>(new Set())

  const [states, setStates] = useState<Record<string, string>>(() =>
    Object.fromEntries(BOTS.map(b => [b.id, 'exploiting'])))
  const [active, setActive] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(BOTS.map(b => [b.id, false])))
  const [selected, setSelected] = useState<string | null>(null)
  const [bubbles, setBubbles] = useState<any[]>([])
  const [log, setLog] = useState<any[]>([])
  const [regime, setRegime] = useState<string>('normal')
  const [time, setTime] = useState<string>('')
  const [loopHealthy, setLoopHealthy] = useState<boolean>(true)
  const [simStats, setSimStats] = useState<any>(null)
  const [lastUpdated, setLastUpdated] = useState<string>('–')

  useEffect(() => {
    async function poll() {
      try {
        const [sRes, bRes, hRes, rRes, eRes] = await Promise.all([
          fetch('/api/simulation-stats', { cache: 'no-store' }),
          fetch('/api/bot-states', { cache: 'no-store' }),
          fetch('/api/loop-health', { cache: 'no-store' }),
          fetch('/api/regime', { cache: 'no-store' }),
          fetch('/api/episodes?limit=20', { cache: 'no-store' }),
        ])

        if (sRes.ok) setSimStats(await sRes.json())

        if (bRes.ok) {
          const { bot_states } = await bRes.json()
          const newStates: Record<string, string> = {}
          for (const bs of bot_states ?? []) {
            const cid = resolveBotId(String(bs.bot_id))
            if (cid) newStates[cid] = String(bs.current_state ?? 'exploiting')
          }
          if (Object.keys(newStates).length > 0) setStates(s => ({ ...s, ...newStates }))
        }

        if (hRes.ok) {
          const h = await hRes.json()
          setLoopHealthy(Boolean(h.healthy))
          if (h.lastEpisodeAt) {
            const mins = h.minutesAgo
            setLastUpdated(mins === 0 ? 'just now' : mins === 1 ? '1m ago' : `${mins}m ago`)
          }
        }

        if (rRes.ok) {
          const { regime: rData } = await rRes.json()
          setRegime(rData?.value?.vol_regime ?? 'normal')
        }

        if (eRes.ok) {
          const { episodes } = await eRes.json()
          const newEps = (episodes ?? []).filter((ep: any) => !prevEpisodeIdsRef.current.has(ep.id))
          for (const ep of newEps.slice(0, 3)) {
            prevEpisodeIdsRef.current.add(ep.id)
            const cid = resolveBotId(String(ep.bot_id ?? ''))
            if (!cid) continue
            const bot = BOTS.find(b => b.id === cid)
            if (!bot) continue
            const taskType = String(ep.task_type ?? '')
            if (taskType === 'loop_heartbeat') continue
            const msg = TASK_MESSAGES[taskType] ?? taskType.replace(/_/g, ' ')
            const id = Date.now() + Math.random()
            setActive(a => ({ ...a, [cid]: true }))
            setTimeout(() => setActive(a => ({ ...a, [cid]: false })), 3000)
            setBubbles(b => [...b.slice(-5), { id, botId: cid, msg, born: Date.now() }])
            setTimeout(() => setBubbles(b => b.filter((x: any) => x.id !== id)), 3500)
            setLog(l => [{ time: new Date(ep.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), label: bot.label, hex: bot.hex, e: bot.e, msg, outcome: ep.outcome }, ...l.slice(0, 29)])
          }
          if (prevEpisodeIdsRef.current.size < 20) {
            for (const ep of episodes ?? []) prevEpisodeIdsRef.current.add(ep.id)
          }
        }
      } catch {}
    }
    poll()
    const iv = setInterval(poll, 15000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => { statesRef.current = states }, [states])
  useEffect(() => { activeRef.current = active }, [active])
  useEffect(() => { selRef.current = selected }, [selected])

  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const canvas = cvs.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    function frame(ts: number) {
      drawScene(ctx as CanvasRenderingContext2D, ts, statesRef.current, activeRef.current, selRef.current)
      raf.current = requestAnimationFrame(frame)
    }
    raf.current = requestAnimationFrame(frame)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [])

  const handleClick = useCallback((e: any) => {
    const canvas = cvs.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (CW / rect.width)
    const my = (e.clientY - rect.top) * (CH / rect.height)
    for (const bot of BOTS as any[]) {
      const { x, y } = sc(bot.c, bot.r + 0.6)
      if (Math.abs(mx - x) < 16 && Math.abs(my - (y - 10)) < 24) {
        setSelected(s => s === bot.id ? null : bot.id)
        return
      }
    }
    setSelected(null)
  }, [])

  const rc = REGIMES[regime] || REGIMES.normal
  const capital = Number(simStats?.currentCapital ?? 5000)
  const totalPnl = Number(simStats?.totalPnl ?? 0)
  const pnlColor = totalPnl >= 0 ? '#00c896' : '#ff3c6e'
  const selectedBot = selected ? BOTS.find(b => b.id === selected) : null
  const selectedState = selected ? (SS[states[selected] || 'exploiting']) : null

  return (
    <div style={{ background: '#07090f', minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif", color: '#f0f0f0' }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes shimmer { 0%{transform:translateX(-200%)} 100%{transform:translateX(200%)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
      `}</style>

      {/* ── Status bar ── */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {/* Regime pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: rc.bg, border: `1px solid ${rc.border}` }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: rc.color, boxShadow: `0 0 8px ${rc.color}`, animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: rc.color }}>{rc.label}</span>
        </div>

        {/* Capital */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Capital</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#00f0ff', fontFamily: "'Courier New', monospace" }}>
            ${capital.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* P&L */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>P&L</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: pnlColor, fontFamily: "'Courier New', monospace" }}>
            {totalPnl >= 0 ? '+' : ''}${Math.abs(totalPnl).toFixed(2)}
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Health */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: loopHealthy ? '#00c896' : '#ff3c6e', boxShadow: loopHealthy ? '0 0 8px #00c896' : 'none', animation: loopHealthy ? 'pulse 2s infinite' : 'none' }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Courier New', monospace" }}>
            {loopHealthy ? `LIVE · ${lastUpdated}` : 'STALE'}
          </span>
        </div>

        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: "'Courier New', monospace" }}>{time}</span>
      </div>

      {/* ── Main layout ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Canvas area */}
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <canvas
            ref={cvs}
            width={CW}
            height={CH}
            onClick={handleClick}
            style={{ display: 'block', width: '100%', height: 'auto', cursor: 'crosshair', imageRendering: 'pixelated' }}
          />

          {/* Speech bubbles */}
          {bubbles.map((b: any) => {
            const bot: any = BOTS.find(x => x.id === b.botId)
            if (!bot) return null
            const { x, y } = sc(bot.c, bot.r + 0.6)
            const age = Math.min(1, (Date.now() - b.born) / 3500)
            const op = age > 0.7 ? 1 - (age - 0.7) / 0.3 : Math.min(1, age * 5)
            return (
              <div key={b.id} style={{ position: 'absolute', left: `${(x / CW) * 100}%`, top: `${((y - 85) / CH) * 100}%`, transform: 'translateX(-50%)', background: 'rgba(7,9,15,0.96)', border: `1px solid ${bot.hex}66`, borderRadius: 8, padding: '5px 10px', fontSize: 11, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 20, opacity: op, boxShadow: `0 4px 20px ${bot.hex}33`, color: '#f0f0f0', fontFamily: '-apple-system, sans-serif', fontWeight: 500, backdropFilter: 'blur(8px)' }}>
                {b.msg}
                <div style={{ position: 'absolute', bottom: -5, left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: `5px solid ${bot.hex}66` }} />
              </div>
            )
          })}
        </div>

        {/* ── Desktop right panel ── */}
        <div style={{ width: 220, borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.2)', flexShrink: 0 }} className="hide-on-mobile">
          
          {/* Selected bot detail */}
          {selectedBot && selectedState ? (
            <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: `${selectedBot.hex}0d` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>{selectedBot.e}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: selectedBot.hex }}>{selectedBot.label}</div>
                  <div style={{ fontSize: 10, color: selectedState.fg, marginTop: 1, letterSpacing: '0.08em' }}>{selectedState.lb}</div>
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
                Tap to deselect
              </button>
            </div>
          ) : (
            <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Bot Status</div>
            </div>
          )}

          {/* Bot list */}
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 10px' }}>
            {BOTS.map(bot => {
              const st = SS[states[bot.id] || 'exploiting']
              const isAct = active[bot.id]
              const isSel = selected === bot.id
              return (
                <div key={bot.id} onClick={() => setSelected(s => s === bot.id ? null : bot.id)}
                  style={{ marginBottom: 4, padding: '8px 10px', borderRadius: 8, border: `1px solid ${isSel ? bot.hex + '88' : 'rgba(255,255,255,0.05)'}`, background: isSel ? bot.hex + '12' : isAct ? bot.hex + '08' : 'transparent', cursor: 'pointer', position: 'relative', overflow: 'hidden', transition: 'all 0.15s' }}>
                  {isAct && <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg,transparent,${bot.hex}15,transparent)`, animation: 'shimmer 1.2s infinite' }} />}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{bot.e}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: isAct ? '#f0f0f0' : 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bot.label}</div>
                      <div style={{ fontSize: 9, color: st.fg, marginTop: 1, letterSpacing: '0.06em' }}>{st.lb}</div>
                    </div>
                    {isAct && <div style={{ width: 5, height: 5, borderRadius: '50%', background: bot.hex, flexShrink: 0, animation: 'blink 0.6s infinite', boxShadow: `0 0 6px ${bot.hex}` }} />}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Activity log */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ padding: '8px 14px 6px', fontSize: 10, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Activity</div>
            <div style={{ height: 160, overflow: 'auto', padding: '0 10px 8px' }}>
              {log.length === 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', padding: '4px 4px' }}>Waiting for activity...</div>}
              {log.map((entry: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>{entry.e}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.msg}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 1 }}>{entry.time}</div>
                  </div>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: entry.outcome === 'correct' || entry.outcome === 'partial' ? '#00c896' : 'rgba(255,255,255,0.15)', flexShrink: 0, marginTop: 4 }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile bot strip + log ── */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.5)' }} className="show-on-mobile">
        {/* Scrollable bot chips */}
        <div style={{ display: 'flex', overflowX: 'auto', gap: 8, padding: '10px 16px', scrollbarWidth: 'none' }}>
          {BOTS.map(bot => {
            const st = SS[states[bot.id] || 'exploiting']
            const isAct = active[bot.id]
            return (
              <div key={bot.id} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, border: `1px solid ${isAct ? bot.hex + '88' : 'rgba(255,255,255,0.08)'}`, background: isAct ? bot.hex + '18' : 'rgba(255,255,255,0.03)', position: 'relative', overflow: 'hidden', transition: 'all 0.2s' }}>
                {isAct && <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg,transparent,${bot.hex}20,transparent)`, animation: 'shimmer 1.2s infinite' }} />}
                <span style={{ fontSize: 14 }}>{bot.e}</span>
                <span style={{ fontSize: 11, fontWeight: isAct ? 600 : 400, color: isAct ? '#f0f0f0' : 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>{bot.label}</span>
                {isAct && <div style={{ width: 5, height: 5, borderRadius: '50%', background: bot.hex, animation: 'blink 0.6s infinite', boxShadow: `0 0 6px ${bot.hex}` }} />}
              </div>
            )
          })}
        </div>
        {/* Mini log */}
        {log.length > 0 && (
          <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {log.slice(0, 5).map((entry: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                <span style={{ fontSize: 12 }}>{entry.e}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.msg}</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{entry.time}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
