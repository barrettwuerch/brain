'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// NOTE: This component is intentionally self-contained and uses mock data.
// We will wire real data sources (via /api/*) in a later pass.

// ─── MOCK CAPITAL DATA ─────────────────────────────────────────────
function genTrades(days: number = 90) {
  const out: any[] = []
  let cap = 25000
  const now = Date.now()
  let id = 1
  for (let i = days; i >= 0; i--) {
    const n = Math.floor(Math.random() * 4)
    for (let j = 0; j < n; j++) {
      const win = Math.random() > 0.38
      const size = cap * (0.01 + Math.random() * 0.025)
      const pnl = win
        ? size * (0.05 + Math.random() * 0.18)
        : -size * (0.03 + Math.random() * 0.12)
      cap += pnl
      out.push({
        id: id++,
        date: new Date(now - i * 86400000),
        win,
        pnl: Math.round(pnl * 100) / 100,
        cap: Math.round(cap * 100) / 100,
      })
    }
  }
  return out
}

const ALL_TRADES = genTrades(90)
const CURRENT_CAP = ALL_TRADES.length ? ALL_TRADES[ALL_TRADES.length - 1].cap : 25000
const INITIAL_CAP = 25000

// ─── CANVAS ───────────────────────────────────────────────────────
const CW = 780,
  CH = 560
const TW = 60,
  TH = 30
const OX = CW * 0.47,
  OY = 70
function sc(c: number, r: number) {
  return { x: OX + ((c - r) * TW) / 2, y: OY + ((c + r) * TH) / 2 }
}

// ─── COLORS ───────────────────────────────────────────────────────
const P = {
  bg: '#07090f',
  fl0: '#0c1422',
  fl1: '#101928',
  flG: 'rgba(60,100,220,0.06)',
  wT: '#13203a',
  wL: '#0a1628',
  wR: '#0d1c32',
  dT: '#1b3526',
  dL: '#112218',
  dR: '#152c1e',
  ptT: '#1a3c10',
  ptL: '#112608',
  ptR: '#162e0c',
}

// ─── BOTS ─────────────────────────────────────────────────────────
const BOTS = [
  { id: 'cos', label: 'Chief of Staff', e: '👑', hex: '#f472b6', c: 4, r: 0, isCoS: true },
  { id: 'research', label: 'Research Bot', e: '🔬', hex: '#22d3ee', c: 1, r: 2 },
  { id: 'strategy', label: 'Strategy Bot', e: '♟', hex: '#a78bfa', c: 4, r: 2 },
  { id: 'risk', label: 'Risk Bot', e: '⚠', hex: '#f87171', c: 7, r: 2 },
  { id: 'execution', label: 'Execution Bot', e: '⚡', hex: '#fbbf24', c: 1, r: 6 },
  { id: 'intel', label: 'Intelligence Bot', e: '🦉', hex: '#34d399', c: 4, r: 6 },
  { id: 'orch', label: 'Orchestrator', e: '🎯', hex: '#e879f9', c: 7, r: 6 },
  { id: 'scanner', label: 'Scanner Bot', e: '📡', hex: '#fb923c', c: 4, r: 9 },
]

const EV: Record<string, string[]> = {
  cos: ['👑 Daily brief: ALL CLEAR', '📋 Priorities set for week', '🔍 Blind spot detected!', '📬 Decision packet sent', '⚠ Regime gap — directive issued'],
  research: ['🔍 Scanning Kalshi...', '📊 Vol anomaly: BTC!', '✨ RQS 0.71 — routing!', '🔬 Validating mechanism', '💀 Archived: weak edge'],
  strategy: ['♟ Formalizing edge...', '⚔ Challenge: testing...', '📋 Walk-forward: 2/3 ✓', '✅ Strategy approved!', '❌ Failed challenge'],
  risk: ['📡 Regime: LOW vol', '💰 Kelly: 2.3% capital', '⚠ ENP low — concentrate!', '🚨 CIRCUIT BREAKER!', '✅ Portfolio nominal'],
  execution: ['⚡ Placing order...', '✅ Filled @ 0.73', '📍 Managing position', '⏰ 6h to resolution!', '💰 Closed: +2.1% ✓'],
  intel: ['🦉 Consolidating...', '📊 IS scores computed', '📝 Daily report ready', '💡 SKILL update proposed!', '📈 Velocity improving'],
  orch: ['🎯 Routing finding...', '🗺 Priority map updated', '📋 Dead ends: 3 patterns', '⚡ All bots healthy', '🔄 Watch condition set'],
  scanner: ['📡 Scanning...', '🔍 Vol regime: OK', '⚡ Condition fired!', '😴 Monitoring quietly...', '✅ 5-gate check: pass'],
}

const REGIMES: Record<string, any> = {
  low: { label: 'LOW VOL', bd: '#22c55e', tx: '#4ade80', bg: 'rgba(34,197,94,0.12)' },
  normal: { label: 'NORMAL', bd: '#3b82f6', tx: '#93c5fd', bg: 'rgba(59,130,246,0.12)' },
  elevated: { label: 'ELEVATED VOL', bd: '#eab308', tx: '#fde047', bg: 'rgba(234,179,8,0.12)' },
  extreme: { label: 'EXTREME VOL', bd: '#ef4444', tx: '#fca5a5', bg: 'rgba(239,68,68,0.12)' },
}

const SS: Record<string, any> = {
  exploiting: { fg: '#4ade80', bd: '#22c55e', bg: 'rgba(34,197,94,0.1)', lb: 'EXPLOITING' },
  cautious: { fg: '#fde047', bd: '#eab308', bg: 'rgba(234,179,8,0.1)', lb: 'CAUTIOUS' },
  paused: { fg: '#fca5a5', bd: '#ef4444', bg: 'rgba(239,68,68,0.1)', lb: 'PAUSED' },
  recovering: { fg: '#93c5fd', bd: '#3b82f6', bg: 'rgba(59,130,246,0.1)', lb: 'RECOVERING' },
  diagnostic: { fg: '#d8b4fe', bd: '#a855f7', bg: 'rgba(168,85,247,0.1)', lb: 'DIAGNOSTIC' },
}

// ─── DRAWING HELPERS ──────────────────────────────────────────────
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
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + TW / 2, y + TH / 2)
  ctx.lineTo(x, y + TH)
  ctx.lineTo(x - TW / 2, y + TH / 2)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.03)'
  ctx.lineWidth = 0.5
  ctx.stroke()
}

function drawCube(
  ctx: CanvasRenderingContext2D,
  c: number,
  r: number,
  h: number,
  top: string,
  left: string,
  right: string,
) {
  const { x, y } = sc(c, r)
  const ty = y - h
  // top
  ctx.beginPath()
  ctx.moveTo(x, ty)
  ctx.lineTo(x + TW / 2, ty + TH / 2)
  ctx.lineTo(x, ty + TH)
  ctx.lineTo(x - TW / 2, ty + TH / 2)
  ctx.closePath()
  ctx.fillStyle = top
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'
  ctx.lineWidth = 0.5
  ctx.stroke()
  // left
  ctx.beginPath()
  ctx.moveTo(x - TW / 2, ty + TH / 2)
  ctx.lineTo(x, ty + TH)
  ctx.lineTo(x, y + TH)
  ctx.lineTo(x - TW / 2, y + TH / 2)
  ctx.closePath()
  ctx.fillStyle = left
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'
  ctx.stroke()
  // right
  ctx.beginPath()
  ctx.moveTo(x + TW / 2, ty + TH / 2)
  ctx.lineTo(x, ty + TH)
  ctx.lineTo(x, y + TH)
  ctx.lineTo(x + TW / 2, y + TH / 2)
  ctx.closePath()
  ctx.fillStyle = right
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'
  ctx.stroke()
}

function drawMonitor(
  ctx: CanvasRenderingContext2D,
  c: number,
  r: number,
  hex: string,
  t: number,
  active: boolean,
) {
  const { x, y } = sc(c, r)
  const mx = x + 4,
    my = y - 34
  const glow = active ? 0.5 + 0.3 * Math.abs(Math.sin(t * 0.006)) : 0.25
  const [rr, gg, bb] = hexRgb(hex)
  // frame
  ctx.fillStyle = '#080e18'
  ctx.fillRect(mx - 13, my - 12, 26, 18)
  ctx.strokeStyle = '#1e2d42'
  ctx.lineWidth = 1
  ctx.strokeRect(mx - 13, my - 12, 26, 18)
  // screen
  ctx.fillStyle = `rgba(${rr},${gg},${bb},${glow * 0.35})`
  ctx.fillRect(mx - 11, my - 10, 22, 14)
  // scanlines
  for (let i = 0; i < 14; i += 2) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.fillRect(mx - 11, my - 10 + i, 22, 1)
  }
  // text simulation
  if (active) {
    ctx.fillStyle = `rgba(${rr},${gg},${bb},0.9)`
    for (let i = 0; i < 3; i++) {
      const w = 8 + Math.floor((Math.sin(t * 0.01 + i * 2) + 1) * 5)
      ctx.fillRect(mx - 10, my - 8 + i * 4, w, 2)
    }
  }
  // stand
  ctx.fillStyle = '#111a2a'
  ctx.fillRect(mx - 3, my + 6, 6, 5)
  ctx.fillRect(mx - 6, my + 11, 12, 3)
}

function drawBotSprite(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  hex: string,
  state: string,
  t: number,
  active: boolean,
  selected: boolean,
) {
  const bob = Math.sin(t * (active ? 0.08 : 0.035)) * (active ? 3 : 1.5)
  const y = by + bob

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.ellipse(bx, by + 10, 12, 4, 0, 0, Math.PI * 2)
  ctx.fill()

  // Legs
  ctx.fillStyle = '#293548'
  const ls = active ? Math.sin(t * 0.12) * 2 : 0
  ctx.fillRect(bx - 7, y + 7, 5, 7 + ls)
  ctx.fillRect(bx + 2, y + 7, 5, 7 - ls)

  // Body
  ctx.fillStyle = hex
  ctx.fillRect(bx - 9, y - 8, 18, 16)

  // Arms
  const arm = active ? Math.sin(t * 0.1) * 7 : 0
  ctx.fillStyle = lx(hex, -25)
  ctx.fillRect(bx - 14, y - 6 + arm, 5, 11)
  ctx.fillRect(bx + 9, y - 6 - arm, 5, 11)

  // Head
  ctx.fillStyle = lx(hex, 35)
  ctx.fillRect(bx - 7, y - 22, 14, 14)

  // Eyes
  ctx.fillStyle = selected ? '#ffffff' : '#0f172a'
  ctx.fillRect(bx - 5, y - 19, 3, 3)
  ctx.fillRect(bx + 2, y - 19, 3, 3)

  // Mouth
  ctx.fillStyle = '#0f172a'
  if (state === 'paused') {
    ctx.fillRect(bx - 3, y - 11, 7, 2)
  } else if (state === 'cautious') {
    ctx.fillRect(bx - 3, y - 10, 2, 2)
    ctx.fillRect(bx + 1, y - 10, 2, 2)
  } else {
    ctx.fillRect(bx - 3, y - 12, 2, 2)
    ctx.fillRect(bx + 1, y - 12, 2, 2)
    ctx.fillRect(bx - 1, y - 11, 3, 1)
  }

  // State dot
  ctx.fillStyle = SS[state].bd
  ctx.shadowColor = SS[state].bd
  ctx.shadowBlur = 8
  ctx.beginPath()
  ctx.arc(bx + 9, y - 25, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0

  // Selection ring
  if (selected) {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.setLineDash([3, 3])
    ctx.strokeRect(bx - 11, y - 24, 22, 38)
    ctx.setLineDash([])
  }
}

function drawCosSprite(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  hex: string,
  state: string,
  t: number,
  active: boolean,
  selected: boolean,
) {
  const bob = Math.sin(t * (active ? 0.08 : 0.035)) * (active ? 3 : 1.5)
  const y = by + bob

  // Shadow (bigger for CoS)
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.beginPath()
  ctx.ellipse(bx, by + 10, 16, 5, 0, 0, Math.PI * 2)
  ctx.fill()

  // Legs
  ctx.fillStyle = '#293548'
  const ls = active ? Math.sin(t * 0.12) * 2 : 0
  ctx.fillRect(bx - 7, y + 7, 5, 7 + ls)
  ctx.fillRect(bx + 2, y + 7, 5, 7 - ls)

  // Body (slightly wider for CoS)
  ctx.fillStyle = hex
  ctx.fillRect(bx - 10, y - 9, 20, 17)

  // Jacket lapels
  ctx.fillStyle = lx(hex, -30)
  ctx.beginPath()
  ctx.moveTo(bx - 4, y - 9)
  ctx.lineTo(bx, y - 3)
  ctx.lineTo(bx + 4, y - 9)
  ctx.closePath()
  ctx.fill()

  // Arms
  const arm = active ? Math.sin(t * 0.1) * 7 : 0
  ctx.fillStyle = lx(hex, -25)
  ctx.fillRect(bx - 16, y - 7 + arm, 6, 12)
  ctx.fillRect(bx + 10, y - 7 - arm, 6, 12)

  // Head
  ctx.fillStyle = lx(hex, 35)
  ctx.fillRect(bx - 8, y - 24, 16, 15)

  // Eyes
  ctx.fillStyle = selected ? '#ffffff' : '#0f172a'
  ctx.fillRect(bx - 6, y - 21, 4, 3)
  ctx.fillRect(bx + 2, y - 21, 4, 3)

  // Mouth — always slight smile
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(bx - 4, y - 13, 2, 2)
  ctx.fillRect(bx, y - 13, 2, 2)
  ctx.fillRect(bx - 2, y - 12, 4, 1)

  // Crown ♛
  const crownGlow = 0.7 + 0.3 * Math.abs(Math.sin(t * 0.004))
  ctx.fillStyle = `rgba(255,220,50,${crownGlow})`
  ctx.shadowColor = 'rgba(255,200,0,0.8)'
  ctx.shadowBlur = 10
  // crown base
  ctx.fillRect(bx - 8, y - 33, 16, 4)
  // crown points
  ctx.beginPath()
  ctx.moveTo(bx - 8, y - 33)
  ctx.lineTo(bx - 8, y - 40)
  ctx.lineTo(bx - 4, y - 35)
  ctx.lineTo(bx, y - 42)
  ctx.lineTo(bx + 4, y - 35)
  ctx.lineTo(bx + 8, y - 40)
  ctx.lineTo(bx + 8, y - 33)
  ctx.closePath()
  ctx.fill()
  ctx.shadowBlur = 0

  // State dot (larger)
  ctx.fillStyle = SS[state].bd
  ctx.shadowColor = SS[state].bd
  ctx.shadowBlur = 10
  ctx.beginPath()
  ctx.arc(bx + 11, y - 27, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0

  // Selection ring
  if (selected) {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.setLineDash([3, 3])
    ctx.strokeRect(bx - 13, y - 44, 26, 58)
    ctx.setLineDash([])
  }
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  t: number,
  stR: Record<string, string>,
  actR: Record<string, boolean>,
  selR: string | null,
) {
  // BG
  ctx.fillStyle = P.bg
  ctx.fillRect(0, 0, CW, CH)

  // Floor (back to front: row 0 first)
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      drawTile(ctx, c, r, (c + r) % 2 === 0 ? P.fl0 : P.fl1)
    }
  }

  // Back wall row
  for (let c = 0; c < 10; c++) drawCube(ctx, c, -1, 28, P.wT, P.wL, P.wR)

  // Wall decorations — big screen on wall
  const ws = sc(5, -1)
  ctx.fillStyle = '#0a0f1c'
  ctx.fillRect(ws.x - 50, ws.y - 52, 100, 38)
  ctx.strokeStyle = '#1e3a5f'
  ctx.lineWidth = 1
  ctx.strokeRect(ws.x - 50, ws.y - 52, 100, 38)
  ctx.fillStyle = 'rgba(34,100,220,0.15)'
  ctx.fillRect(ws.x - 48, ws.y - 50, 96, 34)
  ctx.font = 'bold 8px monospace'
  ctx.fillStyle = '#3b82f6'
  ctx.textAlign = 'center'
  ctx.fillText('THE BRAIN — LIVE', ws.x, ws.y - 38)
  ctx.fillStyle = '#22c55e'
  ctx.fillText('ALL SYSTEMS OPERATIONAL', ws.x, ws.y - 27)
  ctx.fillStyle = '#f472b6'
  ctx.font = '7px monospace'
  ctx.fillText('CoS: ALL CLEAR · 7:02 AM', ws.x, ws.y - 17)

  // Corner plants
  drawCube(ctx, 0, 0, 22, P.ptT, P.ptL, P.ptR)
  drawCube(ctx, 9, 0, 22, P.ptT, P.ptL, P.ptR)

  // Sort bots by iso depth
  const sorted = [...BOTS].sort((a: any, b: any) => a.r + a.c - (b.r + b.c))

  for (const bot of sorted) {
    const state = stR[bot.id] || 'exploiting'
    const isActive = actR[bot.id] || false
    const isSel = selR === bot.id

    // Floor glow under active bots
    if (isActive) {
      const { x, y } = sc(bot.c, bot.r)
      const [rr, gg, bb] = hexRgb(bot.hex)
      const g = ctx.createRadialGradient(x, y + TH, 0, x, y + TH, 45)
      g.addColorStop(0, `rgba(${rr},${gg},${bb},0.18)`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.ellipse(x, y + TH, 45, 18, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    // Desk
    drawCube(ctx, bot.c, bot.r, 16, P.dT, P.dL, P.dR)
    // Monitor
    drawMonitor(ctx, bot.c, bot.r, bot.hex, t, isActive)

    // Character (positioned in front of desk)
    const { x, y } = sc(bot.c, bot.r + 0.6)
    if (bot.isCoS) {
      drawCosSprite(ctx, x, y - 10, bot.hex, state, t, isActive, isSel)
    } else {
      drawBotSprite(ctx, x, y - 10, bot.hex, state, t, isActive, isSel)
    }
  }

  // CRT vignette
  const vg = ctx.createRadialGradient(CW / 2, CH / 2, CH * 0.3, CW / 2, CH / 2, CH * 0.85)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.5)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, CW, CH)

  // Scanline overlay
  for (let i = 0; i < CH; i += 3) {
    ctx.fillStyle = 'rgba(0,0,0,0.04)'
    ctx.fillRect(0, i, CW, 1)
  }
}

// ─── COMPONENT ────────────────────────────────────────────────────
export default function TradingOffice() {
  const cvs = useRef<HTMLCanvasElement | null>(null)
  const raf = useRef<number | null>(null)
  const statesRef = useRef<Record<string, string>>({})
  const activeRef = useRef<Record<string, boolean>>({})
  const selRef = useRef<string | null>(null)

  const [states, setStates] = useState<Record<string, string>>(() =>
    Object.fromEntries(BOTS.map((b: any) => [b.id, 'exploiting'])),
  )
  const [active, setActive] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(BOTS.map((b: any) => [b.id, false])),
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [bubbles, setBubbles] = useState<any[]>([])
  const [log, setLog] = useState<any[]>([])
  const [regime, setRegime] = useState<string>('normal')
  const [time, setTime] = useState<string>('')
  const [scoreMode, setScoreMode] = useState<'pnl' | 'winrate'>('pnl')

  const [simStats, setSimStats] = useState<any>(null)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/simulation-stats', { cache: 'no-store' })
        if (res.ok) setSimStats(await res.json())
      } catch {
        // ignore
      }
    }
    fetchStats()
    const iv = setInterval(fetchStats, 30000)
    return () => clearInterval(iv)
  }, [])

  const stats = useMemo(() => {
    const wins = ALL_TRADES.filter((t: any) => t.win)
    const totalPnl = ALL_TRADES.reduce((s: number, t: any) => s + t.pnl, 0)
    const winRate = ALL_TRADES.length ? (wins.length / ALL_TRADES.length) * 100 : 0
    const capChange = CURRENT_CAP - INITIAL_CAP
    const capPct = (capChange / INITIAL_CAP) * 100
    return {
      totalPnl,
      winRate,
      capChange,
      capPct,
      wins: wins.length,
      losses: ALL_TRADES.length - wins.length,
    }
  }, [])

  // Sync refs
  useEffect(() => {
    statesRef.current = states
  }, [states])
  useEffect(() => {
    activeRef.current = active
  }, [active])
  useEffect(() => {
    selRef.current = selected
  }, [selected])

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000)
    return () => clearInterval(t)
  }, [])

  // Canvas loop
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
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [])

  // Random events
  useEffect(() => {
    const iv = setInterval(() => {
      const bot: any = BOTS[Math.floor(Math.random() * BOTS.length)]
      const msgs = EV[bot.id]
      const msg = msgs[Math.floor(Math.random() * msgs.length)]
      const id = Date.now() + Math.random()

      setActive((a: any) => ({ ...a, [bot.id]: true }))
      setTimeout(() => setActive((a: any) => ({ ...a, [bot.id]: false })), 2800)

      setBubbles((b: any) => [...b.slice(-5), { id, botId: bot.id, msg, born: Date.now() }])
      setTimeout(() => setBubbles((b: any) => b.filter((x: any) => x.id !== id)), 3500)

      setLog((l: any) => [{ time: new Date().toLocaleTimeString(), label: bot.label, hex: bot.hex, msg }, ...l.slice(0, 14)])

      if (Math.random() < 0.07) {
        const keys = Object.keys(SS)
        setStates((s: any) => ({ ...s, [bot.id]: keys[Math.floor(Math.random() * keys.length)] }))
      }
      if (Math.random() < 0.05) {
        const rs = Object.keys(REGIMES)
        setRegime(rs[Math.floor(Math.random() * rs.length)])
      }
    }, 2000)
    return () => clearInterval(iv)
  }, [])

  // Click to select
  const handleClick = useCallback((e: any) => {
    const canvas = cvs.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (CW / rect.width)
    const my = (e.clientY - rect.top) * (CH / rect.height)
    for (const bot of BOTS as any[]) {
      const { x, y } = sc(bot.c, bot.r + 0.6)
      const bx = x,
        by = y - 10
      if (Math.abs(mx - bx) < 16 && Math.abs(my - by) < 24) {
        setSelected((s) => (s === bot.id ? null : bot.id))
        return
      }
    }
    setSelected(null)
  }, [])

  const rc = REGIMES[regime] || REGIMES.normal

  return (
    <div
      style={{
        background: P.bg,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Courier New', monospace",
        color: '#e2e8f0',
        overflow: 'hidden',
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '7px 16px',
          borderBottom: '1px solid rgba(60,100,200,0.2)',
          background: 'rgba(0,0,0,0.5)',
          fontSize: 10,
          letterSpacing: 2,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#3b82f6', fontSize: 14 }}>⬡</span>
          <span style={{ color: '#7c9ccc', textTransform: 'uppercase' }}>The Brain — Trading Floor</span>
        </div>

        {/* SCOREBOARD */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            border: '1px solid rgba(0,240,255,0.2)',
            borderRadius: 4,
            overflow: 'hidden',
            background: 'rgba(0,10,30,0.8)',
          }}
        >
          {/* Capital — always visible */}
          <div style={{ padding: '5px 16px', borderRight: '1px solid rgba(0,240,255,0.15)' }}>
            <div
              style={{
                fontSize: 7,
                letterSpacing: 2,
                color: 'rgba(0,240,255,0.5)',
                textTransform: 'uppercase',
                marginBottom: 2,
              }}
            >
              Total Capital
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 'bold',
                color: '#00f0ff',
                fontFamily: 'monospace',
                textShadow: '0 0 12px #00f0ff88',
                letterSpacing: -0.5,
              }}
            >
              ${(simStats?.currentCapital ?? CURRENT_CAP).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          {/* Toggle metric */}
          <div style={{ padding: '5px 14px', borderRight: '1px solid rgba(0,240,255,0.15)', minWidth: 110 }}>
            <div
              style={{
                fontSize: 7,
                letterSpacing: 2,
                color: 'rgba(0,240,255,0.5)',
                textTransform: 'uppercase',
                marginBottom: 2,
              }}
            >
              {scoreMode === 'pnl' ? 'Net P&L (90d)' : 'Win Rate (90d)'}
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 'bold',
                fontFamily: 'monospace',
                letterSpacing: -0.5,
                color:
                  scoreMode === 'pnl'
                    ? (simStats?.totalPnl ?? stats.totalPnl) >= 0
                      ? '#00ff9f'
                      : '#ff3c6e'
                    : (simStats?.winRate ?? stats.winRate) >= 55
                      ? '#00ff9f'
                      : '#ffe600',
                textShadow: `0 0 12px ${
                  scoreMode === 'pnl'
                    ? (simStats?.totalPnl ?? stats.totalPnl) >= 0
                      ? '#00ff9f'
                      : '#ff3c6e'
                    : '#00ff9f'
                }88`,
              }}
            >
              {scoreMode === 'pnl'
                ? (() => {
                    const pnl = Number(simStats?.totalPnl ?? stats.totalPnl)
                    return `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(0)}`
                  })()
                : `${Number(simStats?.winRate ?? stats.winRate).toFixed(1)}%`}
            </div>
          </div>
          {/* Toggle buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '4px 6px' }}>
            {(['pnl', 'winrate'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setScoreMode(m)}
                style={{
                  fontSize: 7,
                  letterSpacing: 1,
                  padding: '2px 7px',
                  border: `1px solid ${scoreMode === m ? '#00f0ff' : 'rgba(0,240,255,0.2)'}`,
                  background: scoreMode === m ? 'rgba(0,240,255,0.15)' : 'transparent',
                  color: scoreMode === m ? '#00f0ff' : 'rgba(0,240,255,0.4)',
                  cursor: 'pointer',
                  borderRadius: 2,
                  fontFamily: 'monospace',
                  textTransform: 'uppercase',
                  transition: 'all 0.15s',
                }}
              >
                {m === 'pnl' ? 'P&L' : 'WIN%'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 12px',
              border: `1px solid ${rc.bd}`,
              background: rc.bg,
              color: rc.tx,
              letterSpacing: 2,
              textTransform: 'uppercase',
              fontSize: 9,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: rc.bd,
                display: 'inline-block',
                boxShadow: `0 0 6px ${rc.bd}`,
              }}
            />
            {rc.label}
          </div>
          <span style={{ color: '#334155', fontSize: 9 }}>{time}</span>
        </div>
      </div>

      {/* Main */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Canvas */}
        <div style={{ position: 'relative', flex: 1 }}>
          <canvas
            ref={cvs}
            width={CW}
            height={CH}
            onClick={handleClick}
            style={{
              display: 'block',
              cursor: 'crosshair',
              width: '100%',
              height: 'auto',
              imageRendering: 'pixelated',
            }}
          />

          {/* Speech Bubbles */}
          {bubbles.map((b: any) => {
            const bot: any = (BOTS as any[]).find((x) => x.id === b.botId)
            if (!bot) return null
            const { x, y } = sc(bot.c, bot.r + 0.6)
            const age = Math.min(1, (Date.now() - b.born) / 3500)
            const op = age > 0.7 ? 1 - (age - 0.7) / 0.3 : Math.min(1, age * 5)
            return (
              <div
                key={b.id}
                style={{
                  position: 'absolute',
                  left: `${(x / CW) * 100}%`,
                  top: `${((y - 85) / CH) * 100}%`,
                  transform: 'translateX(-50%)',
                  background: 'rgba(6,9,18,0.96)',
                  border: `1px solid ${bot.hex}`,
                  borderRadius: 5,
                  padding: '5px 10px',
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  zIndex: 20,
                  opacity: op,
                  boxShadow: `0 0 12px ${bot.hex}44`,
                  color: '#e2e8f0',
                  transition: 'opacity 0.1s',
                }}
              >
                {b.msg}
                <div
                  style={{
                    position: 'absolute',
                    bottom: -6,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 0,
                    height: 0,
                    borderLeft: '5px solid transparent',
                    borderRight: '5px solid transparent',
                    borderTop: `6px solid ${bot.hex}`,
                  }}
                />
              </div>
            )
          })}
        </div>

        {/* Right Panel */}
        <div
          style={{
            width: 210,
            borderLeft: '1px solid rgba(60,100,200,0.15)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          {/* Bot Status */}
          <div
            style={{
              padding: '7px 10px',
              borderBottom: '1px solid rgba(60,100,200,0.12)',
              fontSize: 8,
              letterSpacing: 2,
              color: '#334155',
              textTransform: 'uppercase',
            }}
          >
            Bot Status
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '6px 8px' }}>
            {(BOTS as any[]).map((bot) => {
              const st = SS[states[bot.id] || 'exploiting']
              const isAct = active[bot.id]
              const isSel = selected === bot.id
              return (
                <div
                  key={bot.id}
                  onClick={() => setSelected((s) => (s === bot.id ? null : bot.id))}
                  style={{
                    marginBottom: 5,
                    padding: '6px 8px',
                    border: `1px solid ${isSel ? '#ffffff' : st.bd + '55'}`,
                    borderRadius: 4,
                    background: isSel ? 'rgba(255,255,255,0.06)' : st.bg,
                    cursor: 'pointer',
                    position: 'relative',
                    overflow: 'hidden',
                    transition: 'border-color 0.2s',
                  }}
                >
                  {isAct && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: `linear-gradient(90deg,transparent,${bot.hex}18,transparent)`,
                        animation: 'shimmer 1.2s ease-in-out infinite',
                      }}
                    />
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 13 }}>{bot.e}</span>
                    <span
                      style={{
                        fontSize: 10,
                        color: '#cbd5e1',
                        fontWeight: 'bold',
                        flex: 1,
                      }}
                    >
                      {bot.label}
                    </span>
                    {isAct && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: bot.hex,
                          boxShadow: `0 0 6px ${bot.hex}`,
                          flexShrink: 0,
                          animation: 'blink 0.6s infinite',
                        }}
                      />
                    )}
                  </div>
                  <div style={{ fontSize: 8, color: st.fg, letterSpacing: 1.5, fontWeight: 'bold' }}>{st.lb}</div>
                </div>
              )
            })}
          </div>

          {/* Selected Bot Detail */}
          {selected &&
            (() => {
              const bot: any = (BOTS as any[]).find((b) => b.id === selected)
              const st = SS[states[selected] || 'exploiting']
              return bot ? (
                <div
                  style={{
                    borderTop: '1px solid rgba(60,100,200,0.15)',
                    padding: '8px 10px',
                    background: 'rgba(0,0,0,0.3)',
                  }}
                >
                  <div
                    style={{
                      fontSize: 8,
                      letterSpacing: 2,
                      color: '#334155',
                      textTransform: 'uppercase',
                      marginBottom: 6,
                    }}
                  >
                    Selected
                  </div>
                  <div style={{ fontSize: 11, color: bot.hex, fontWeight: 'bold', marginBottom: 3 }}>
                    {bot.e} {bot.label}
                  </div>
                  <div style={{ fontSize: 8, color: st.fg, letterSpacing: 1 }}>{st.lb}</div>
                  <div style={{ marginTop: 6, fontSize: 8, color: '#475569' }}>Click again to deselect</div>
                </div>
              ) : null
            })()}

          {/* Activity Log */}
          <div
            style={{
              borderTop: '1px solid rgba(60,100,200,0.12)',
              padding: '7px 10px',
              fontSize: 8,
              letterSpacing: 2,
              color: '#334155',
              textTransform: 'uppercase',
            }}
          >
            Activity Log
          </div>
          <div style={{ height: 140, overflow: 'auto', padding: '4px 8px' }}>
            {log.map((entry: any, i: number) => (
              <div
                key={i}
                style={{
                  marginBottom: 4,
                  paddingBottom: 3,
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  fontSize: 8,
                  lineHeight: 1.5,
                }}
              >
                <span style={{ color: '#334155' }}>{entry.time} </span>
                <span style={{ color: entry.hex }}>{entry.label.split(' ')[0]}: </span>
                <span style={{ color: '#64748b' }}>{entry.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          padding: '5px 16px',
          borderTop: '1px solid rgba(60,100,200,0.12)',
          background: 'rgba(0,0,0,0.4)',
          display: 'flex',
          gap: 20,
          fontSize: 8,
          color: '#1e3a5f',
          letterSpacing: 1,
        }}
      >
        <span>BLOCKS COMPLETE: 1–5 · SIMULATION RUNNING · KALSHI DEMO + ALPACA PAPER</span>
        <span style={{ marginLeft: 'auto' }}>CLICK BOT TO INSPECT · EVENTS SIMULATED</span>
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes shimmer { 0%{transform:translateX(-200%)} 100%{transform:translateX(200%)} }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 2px; }
      `}</style>
    </div>
  )
}
