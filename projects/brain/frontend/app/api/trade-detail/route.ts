import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const positionId = searchParams.get('position_id')
  if (!positionId) return NextResponse.json({ error: 'missing position_id' }, { status: 400 })

  const supabase = getSupabaseAdmin()

  const { data: episodes } = await supabase
    .from('episodes')
    .select('task_type, observation, outcome, outcome_score, reasoning, action_taken, reflection, lessons, created_at')
    .or(`task_input->position_id.eq.${positionId},lessons.cs.["position_id:${positionId}"]`)
    .order('created_at', { ascending: true })
    .limit(50)

  const { data: position } = await supabase
    .from('positions')
    .select('*')
    .eq('id', positionId)
    .maybeSingle()

  return NextResponse.json({ position, episodes: episodes ?? [] })
}
