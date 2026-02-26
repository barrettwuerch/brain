import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { json, jsonError } from '@/lib/http'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const days = Math.max(1, Math.min(Number(url.searchParams.get('days') ?? '30'), 365))
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('intelligence_scores')
      .select('id,created_at,task_type,metric,value,notes')
      .eq('metric', 'intelligence_score')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) return jsonError(error.message, 500)

    return json({ ok: true, intelligence_scores: data ?? [] })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
