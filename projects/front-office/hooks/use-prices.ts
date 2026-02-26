import { usePoll } from './use-poll'

export function usePrices() {
  return usePoll(async () => {
    const res = await fetch('/api/prices', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok || !j.ok) throw new Error(j.error ?? 'prices failed')
    return j as any
  }, 30000)
}
