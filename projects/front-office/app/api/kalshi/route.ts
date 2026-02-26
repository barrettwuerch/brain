import { json, jsonError } from '@/lib/http'
import { getBalance, getOrdersOpen } from '@/lib/kalshi'

export async function GET() {
  try {
    const bal = await getBalance()
    const orders = await getOrdersOpen()

    return json({
      ok: true,
      balance: bal,
      open_orders_count: Array.isArray((orders as any)?.orders) ? (orders as any).orders.length : null,
    })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
