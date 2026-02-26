import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { json, jsonError } from '@/lib/http'

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin()

    const { data: bots, error } = await supabaseAdmin
      .from('bot_states')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) return jsonError(error.message, 500)

    // Add last activity per bot from episodes (latest per bot_id).
    const { data: eps, error: eErr } = await supabaseAdmin
      .from('episodes')
      .select('bot_id,task_type,created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    if (eErr) return jsonError(eErr.message, 500)

    const latest = new Map<string, { task_type: string; created_at: string }>()
    for (const r of eps ?? []) {
      const bid = String((r as any).bot_id ?? '')
      if (!bid) continue
      if (!latest.has(bid)) {
        latest.set(bid, { task_type: String((r as any).task_type ?? ''), created_at: String((r as any).created_at ?? '') })
      }
    }

    const merged = (bots ?? []).map((b: any) => {
      const last = latest.get(String(b.bot_id))
      return {
        ...b,
        last_task_type: last?.task_type ?? null,
        last_activity_at: last?.created_at ?? null,
      }
    })

    return json({ ok: true, bot_states: merged })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
