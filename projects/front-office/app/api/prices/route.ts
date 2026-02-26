import { json, jsonError } from '@/lib/http'
import { getAccount, getPositions } from '@/lib/alpaca'

export async function GET() {
  try {
    const acct = await getAccount()
    const positions = await getPositions()

    return json({
      ok: true,
      equity: Number(acct.equity ?? 0),
      buying_power: Number(acct.buying_power ?? 0),
      status: String(acct.status ?? ''),
      positions: Array.isArray(positions) ? positions : [],
    })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
