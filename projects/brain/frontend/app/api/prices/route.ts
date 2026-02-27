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

    const totalCapital = Number((capRow as any)?.value?.amount ?? 5000)

    return json({
      ok: true,
      equity: totalCapital,
      alpaca_equity_actual: Number(acct.equity ?? 0),
      buying_power: Number(acct.buying_power ?? 0),
      status: String(acct.status ?? ''),
      positions: Array.isArray(positions) ? positions : [],
    })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
