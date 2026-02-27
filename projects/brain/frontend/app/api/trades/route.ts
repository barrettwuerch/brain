import { NextResponse } from 'next/server'

import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function baseUrl(): string {
  return (process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets').replace(/\/$/, '')
}

function authHeaders() {
  const key = process.env.ALPACA_API_KEY
  const secret = process.env.ALPACA_SECRET_KEY
  if (!key || !secret) throw new Error('Missing ALPACA_API_KEY/ALPACA_SECRET_KEY')
  return {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
  }
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: authHeaders(), cache: 'no-store' })
  const text = await res.text()
  let j: any
  try {
    j = text ? JSON.parse(text) : null
  } catch {
    j = text
  }
  if (!res.ok) throw new Error(`Alpaca ${res.status}: ${typeof j === 'string' ? j : JSON.stringify(j)}`)
  return j
}

export async function GET() {
  try {
    const trades: any[] = []

    // Alpaca filled orders
    try {
      const url = new URL(baseUrl() + '/v2/orders')
      url.searchParams.set('status', 'closed')
      url.searchParams.set('limit', '50')
      url.searchParams.set('direction', 'desc')

      const orders = (await fetchJson(url.toString())) as any[]
      for (const o of orders ?? []) {
        if (String(o.status) !== 'filled') continue
        trades.push({
          id: o.id,
          desk: 'crypto',
          symbol: o.symbol,
          side: o.side,
          qty: Number(o.filled_qty ?? o.qty ?? 0),
          entry_price: o.filled_avg_price != null ? Number(o.filled_avg_price) : null,
          exit_price: null,
          pnl: null,
          status: 'filled',
          opened_at: o.submitted_at,
          closed_at: o.filled_at ?? o.updated_at ?? null,
          source: 'alpaca',
        })
      }
    } catch (e: any) {
      console.error('Alpaca error:', String(e?.message ?? e))
    }

    // Kalshi / Supabase positions
    try {
      const supabase = getSupabaseAdmin()
      const { data: positions, error } = await supabase
        .from('positions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error

      for (const pos of positions ?? []) {
        const p: any = pos
        trades.push({
          id: p.id,
          desk: p.desk ?? 'prediction',
          symbol: p.market_ticker ?? p.symbol ?? p.ticker ?? '—',
          side: p.side ?? 'buy',
          qty: p.contracts ?? p.qty ?? 1,
          entry_price: p.entry_price ?? null,
          exit_price: p.exit_price ?? null,
          pnl: p.realized_pnl ?? null,
          status: p.closed_at ? 'closed' : 'open',
          opened_at: p.created_at,
          closed_at: p.closed_at,
          source: 'kalshi',
        })
      }
    } catch (e: any) {
      console.error('Positions error:', String(e?.message ?? e))
    }

    trades.sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime())

    return NextResponse.json({ trades, count: trades.length })
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 })
  }
}
