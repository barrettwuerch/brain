import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function normalizeSide(s: string) {
  if (s === 'yes') return 'buy'
  if (s === 'no') return 'sell'
  return s
}

export async function GET() {
  try {
    const trades: any[] = []

    // Supabase positions — source of truth for all trades
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

        trades.push({
          id: p.id,
          position_id: p.id,
          exit_reason: p.exit_reason ?? null,
          stop_level: p.stop_level ?? null,
          profit_target: p.profit_target ?? null,
          desk: desk === 'crypto_markets' ? 'crypto' : 'prediction',
          symbol: ticker,
          side: normalizeSide(String(p.side ?? 'buy')),
          qty: (() => { const raw = Number(p.closed_at ? (p.size ?? p.remaining_size ?? 1) : (p.remaining_size ?? p.size ?? 1)); return (desk === 'crypto_markets' && raw > 1000) ? raw / 1e8 : raw; })(),
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
