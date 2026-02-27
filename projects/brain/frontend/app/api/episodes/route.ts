import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { json, jsonError } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200)
    const desk = url.searchParams.get('desk') ?? null
    const supabase = getSupabaseAdmin()

    let q = supabase
      .from('episodes')
      .select('id,created_at,task_type,agent_role,desk,bot_id,reasoning,action_taken,observation,reflection,lessons,outcome,outcome_score,reasoning_score,error_type,task_input')
      .order('created_at', { ascending: false })
      .limit(limit)
      .neq('task_type', 'loop_heartbeat')

    if (desk) q = q.eq('desk', desk)

    const { data, error } = await q
    if (error) return jsonError(error.message, 500)
    return json({ ok: true, episodes: data ?? [] })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
