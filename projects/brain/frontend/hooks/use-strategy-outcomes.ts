import { usePoll } from './use-poll'

export function useStrategyOutcomes() {
  return usePoll(async () => {
    const res = await fetch('/api/strategy-outcomes?limit=100', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok || !j.ok) throw new Error(j.error ?? 'strategy-outcomes failed')
    return j.strategy_outcomes as any[]
  }, 60000)
}
