import { usePoll } from './use-poll'

export function usePipeline() {
  return usePoll(async () => {
    const res = await fetch('/api/pipeline', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok || !j.ok) throw new Error(j.error ?? 'pipeline failed')
    return j as any
  }, 30000)
}
