import { usePoll } from './use-poll'

export function useIsScores() {
  return usePoll(async () => {
    const res = await fetch('/api/intelligence-scores', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok || !j.ok) throw new Error(j.error ?? 'is-scores failed')
    return j.intelligence_scores as any[]
  }, 30000)
}
