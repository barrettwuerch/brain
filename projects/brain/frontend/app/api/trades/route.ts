import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function baseUrl() {
  return (process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets').replace(/\/$/, '')
}
function authHeaders() {
  const key = process.env.ALPACA_API_KEY
  const secret = process.env.ALPACA_SECRET_KEY
  if (!key || !secret) throw new Error('Missing Alpaca keys')
  return { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret }
}
async function fetchJson(url: string) {
  const res = await fetch(url, { headers: authHeaders(), cache: 'no-store' })
  const text = await res.text()
  const j = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`Alpaca ${res.status}: ${JSON.stringify(j)}`)
  return j
}
function stripSlash(s: string) { return s.replace('/', '') }
function normalizeSide(s: string) {
  if (s === 'yes') return 'buy'
  if (s === 'no') return 'sell'
  return s
}

export async function GET() {
  try {
    const trades: any[] = []
    const alpacaSymbols = new Set<string>()

    // Alpaca filled orders — source of truth for crypto
    try {
      const url = new URL(baseUrl() + '/v2/orders')
      url.searchParams.set('status', 'closed')
      url.searchParams.set('limit', '50')
      url.searchParams.set('direction', 'desc')
      const orders = (await fetchJson(url.toString())) as any[]
      for (const o of orders ?? []) {
        if (String(o.status) !== 'filled') continue
        const sym = String(o.symbol)
        alpacaSymbols.add(sym)
        trades.push({
          id: o.id,
          desk: 'crypto',
          symbol: sym,
          side: normalizeSide(String(o.side)),
          qty: Number(o.filled_qty ?? o.qty ?? 0),
          entry_price: o.filled_avg_price != null ? Number(o.filled_avg_price) : null,
          exit_price: null,
          pnl: null,
          status: 'open',
          opened_at: o.submitted_at,
          closed_at: o.filled_at ?? o.updated_at ?? null,
          source: 'alpaca',
        })
      }
    } catch (e: any) {
      console.error('Alpaca error:', e?.message)
    }

    // Supabase positions — only non-crypto or crypto not already in Alpaca
    try {
      const supabase = getSupabaseAdmin()
      const { data: positions } = await supabase
        .from('positions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      for (const pos of positions ?? []) {
        const p = pos as any
        const ticker = String(p.market_ticker ?? p.symbol ?? '—')
        const desk = String(p.desk ?? 'prediction')

        // Skip crypto positions that are already represented by Alpaca orders
        if (desk === 'crypto_markets' && alpacaSymbols.has(stripSlash(ticker))) continue

        trades.push({
          id: p.id,
          desk: desk === 'crypto_markets' ? 'crypto' : 'prediction',
          symbol: ticker,
          side: normalizeSide(String(p.side ?? 'buy')),
          qty: (() => { const raw = Number(p.remaining_size ?? p.size ?? 1); return (desk === 'crypto_markets' && raw > 1000) ? raw / 1e8 : raw; })(),
          entry_price: p.entry_price ?? null,
          exit_price: p.exit_price ?? null,
          pnl: p.realized_pnl ?? null,
          status: p.closed_at ? 'closed' : 'open',
          opened_at: p.created_at,
          closed_at: p.closed_at,
          source: 'supabase',
        })
      }
    } catch (e: any) {
      console.error('Positions error:', e?.message)
    }

    trades.sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime())
    return NextResponse.json({ trades, count: trades.length })
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 })
  }
}
