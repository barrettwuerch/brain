import { NextResponse } from 'next/server'

import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const supabase = getSupabaseAdmin()
    const since = new Date(Date.now() - 86400000).toISOString()

    const { data: rows, error } = await supabase
      .from('scanner_gate_events')
      .select('gate,ticker,reason,edge,score,created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000)

    if (error) throw error

    const gateCounts: Record<string, number> = { gate_0: 0, gate_1: 0, gate_2: 0, gate_3: 0 }
    for (const r of rows ?? []) {
      const g = String((r as any).gate)
      gateCounts[g] = (gateCounts[g] ?? 0) + 1
    }

    const recent = (rows ?? []).slice(0, 20)

    return NextResponse.json({ ok: true, gateCounts, recent })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
