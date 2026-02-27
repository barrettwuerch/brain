import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { json, jsonError } from '@/lib/http'

export async function GET() {
  try {
    const now = new Date().toISOString()

    // Prefer vol_regime published operational_state.
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('operational_state')
      .select('domain,key,value,published_at,expires_at')
      .eq('domain', 'regime_state')
      .eq('key', 'vol_regime')
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return jsonError(error.message, 500)

    return json({ ok: true, regime: data ?? null })
  } catch (e: any) {
    return jsonError(String(e?.message ?? e))
  }
}
