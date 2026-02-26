import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { json, jsonError } from '@/lib/http'

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('episodes')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return jsonError(error.message, 500)

    const last = data?.created_at ? new Date(data.created_at).getTime() : null
    const now = Date.now()
    const secondsSince = last ? Math.floor((now - last) / 1000) : null

    return json({ ok: true, last_episode_at: data?.created_at ?? null, seconds_since_last_episode: secondsSince })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
