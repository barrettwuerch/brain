import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { json, jsonError } from '@/lib/http'

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('bot_states')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) return jsonError(error.message, 500)

    return json({ ok: true, bot_states: data ?? [] })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
