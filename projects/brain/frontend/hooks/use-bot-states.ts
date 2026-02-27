import { usePoll } from './use-poll'

export function useBotStates() {
  return usePoll(async () => {
    const res = await fetch('/api/bot-states', { cache: 'no-store' })
    const j = await res.json()
    if (!res.ok || !j.ok) throw new Error(j.error ?? 'bot-states failed')
    return j.bot_states as any[]
  }, 5000)
}
