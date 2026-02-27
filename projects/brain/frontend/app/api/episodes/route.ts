import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { json, jsonError } from '@/lib/http'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? '50'), 500))

    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('episodes')
      .select('id,created_at,task_type,agent_role,desk,bot_id,outcome,outcome_score,reasoning_score')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return jsonError(error.message, 500)

    return json({ ok: true, episodes: data ?? [] })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
