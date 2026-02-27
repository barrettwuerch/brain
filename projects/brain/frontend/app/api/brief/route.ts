import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { json, jsonError } from '@/lib/http'

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('episodes')
      .select('id,created_at,task_type,action_taken,observation')
      .eq('task_type', 'generate_daily_brief')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return jsonError(error.message, 500)

    return json({ ok: true, brief_episode: data ?? null })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
