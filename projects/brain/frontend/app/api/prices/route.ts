import { json, jsonError } from '@/lib/http'
import { getAccount, getPositions } from '@/lib/alpaca'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  try {
    const acct = await getAccount()
    const positions = await getPositions()

    // Read simulation capital instead of raw Alpaca equity
    const supabase = getSupabaseAdmin()
    const { data: capRow, error: capErr } = await supabase
      .from('operational_state')
      .select('value')
      .eq('domain', 'simulation')
      .eq('key', 'simulation_capital_total')
      .maybeSingle()
    if (capErr) throw capErr

    const totalCapital = Number((capRow as any)?.value?.amount ?? 50000)

    // Get realized P&L from closed positions
    const { data: closedPos } = await supabase
      .from('positions')
      .select('realized_pnl')
      .not('closed_at', 'is', null)
      .not('exit_reason', 'eq', 'manual')
    const realizedPnl = (closedPos ?? []).reduce((s: number, p: any) => s + Number(p.realized_pnl ?? 0), 0)

    // Get unrealized P&L from open positions
    const { data: openPos } = await supabase
      .from('positions')
      .select('unrealized_pnl')
      .is('closed_at', null)
    const unrealizedPnl = (openPos ?? []).reduce((s: number, p: any) => s + Number(p.unrealized_pnl ?? 0), 0)

    return json({
      ok: true,
      equity: totalCapital,
      alpaca_equity_actual: Number(acct.equity ?? 0),
      buying_power: Number(acct.buying_power ?? 0),
      status: String(acct.status ?? ''),
      positions: Array.isArray(positions) ? positions : [],
      realized_pnl: parseFloat(realizedPnl.toFixed(2)),
      unrealized_pnl: parseFloat(unrealizedPnl.toFixed(2)),
      total_pnl: parseFloat((realizedPnl + unrealizedPnl).toFixed(2)),
    })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
