import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { json, jsonError } from '@/lib/http'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const days = Math.max(1, Math.min(Number(url.searchParams.get('days') ?? '7'), 365))
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    const supabaseAdmin = getSupabaseAdmin()

    // Tasks funnel counts
    const { data: tasks, error: tErr } = await supabaseAdmin
      .from('tasks')
      .select('task_type,status,agent_role,created_at')
      .gte('created_at', since)
      .limit(5000)

    if (tErr) return jsonError(tErr.message, 500)

    const rows = (tasks ?? []) as any[]

    const count = (pred: (r: any) => boolean) => rows.filter(pred).length

    const noticed = count((r) => r.task_type === 'market_trend_scan' && r.status === 'completed')
    const scored = count((r) => r.task_type === 'rqs_score_finding' && r.status === 'completed')
    const challenged = count((r) => r.task_type === 'challenge_strategy')

    // research_findings panels
    const { data: findings, error: fErr } = await supabaseAdmin
      .from('research_findings')
      .select('id,created_at,updated_at,status,description,mechanism,notes,rqs_score')
      .order('updated_at', { ascending: false })
      .limit(200)

    if (fErr) return jsonError(fErr.message, 500)

    const under_review = (findings ?? []).filter((x: any) => ['under_investigation', 'challenged'].includes(String(x.status)))
    const live = (findings ?? []).filter((x: any) => String(x.status) === 'approved_for_forward_test')
    const archived = (findings ?? []).filter((x: any) => String(x.status) === 'archived')

    return json({
      ok: true,
      window_days: days,
      funnel: {
        noticed,
        scored,
        challenged,
        live: live.length,
      },
      under_review,
      dead_ends: {
        count: archived.length,
        last5: archived.slice(0, 5),
      },
    })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
