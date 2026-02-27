import { usePoll } from './use-poll'

export function useBrief() {
  return usePoll(async () => {
    const res = await fetch('/api/brief', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok || !j.ok) throw new Error(j.error ?? 'brief failed')
    return j.brief_episode as any
  }, 5 * 60 * 1000)
}
