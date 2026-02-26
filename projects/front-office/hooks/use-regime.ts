import { usePoll } from './use-poll'

export function useRegime() {
  return usePoll(async () => {
    const res = await fetch('/api/regime', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok || !j.ok) throw new Error(j.error ?? 'regime failed')
    return j.regime as any
  }, 30000)
}
