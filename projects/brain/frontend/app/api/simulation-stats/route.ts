import { NextResponse } from 'next/server'

import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  try {
    const supabase = getSupabaseAdmin()

    // Starting capital from simulation baseline
    const { data: baselineRow, error: bErr } = await supabase
      .from('operational_state')
      .select('value')
      .eq('domain', 'simulation')
      .eq('key', 'simulation_baseline')
      .maybeSingle()
    if (bErr) throw bErr

    const baseline = (baselineRow as any)?.value as any
    const startingCapital = Number(baseline?.total_capital ?? 5000)

    // Current capital from operational_state
    const { data: capRow, error: cErr } = await supabase
      .from('operational_state')
      .select('value')
      .eq('domain', 'simulation')
      .eq('key', 'simulation_capital_total')
      .maybeSingle()
    if (cErr) throw cErr

    const currentCapital = Number((capRow as any)?.value?.amount ?? startingCapital)

    // Closed positions for win rate + P&L
    const { data: positions, error: pErr } = await supabase
      .from('positions')
      .select('realized_pnl,closed_at')
      .not('closed_at', 'is', null)
      .order('closed_at', { ascending: false })
      .limit(100)
    if (pErr) throw pErr

    const rows = (positions ?? []) as any[]
    const wins = rows.filter((p) => Number(p.realized_pnl ?? 0) > 0).length
    const total = rows.length
    const totalPnl = rows.reduce((s, p) => s + Number(p.realized_pnl ?? 0), 0)
    const winRate = total > 0 ? (wins / total) * 100 : 0

    // Open positions count
    const { count: openPositions, error: oErr } = await supabase
      .from('positions')
      .select('*', { count: 'exact', head: true })
      .is('closed_at', null)
    if (oErr) throw oErr

    return NextResponse.json({
      currentCapital,
      startingCapital,
      totalPnl,
      winRate,
      openPositions: openPositions ?? 0,
      totalTrades: total,
      wins,
      losses: total - wins,
    })
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 })
  }
}
