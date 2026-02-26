import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { json, jsonError } from '@/lib/http'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? '100'), 500))

    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('strategy_outcomes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return jsonError(error.message, 500)

    return json({ ok: true, strategy_outcomes: data ?? [] })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
