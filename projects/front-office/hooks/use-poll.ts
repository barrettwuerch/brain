import { useEffect, useRef, useState } from 'react'

type AsyncFn<T> = () => Promise<T>

export function usePoll<T>(fn: AsyncFn<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    const run = async () => {
      try {
        setLoading(true)
        const x = await fn()
        if (!alive.current) return
        setData(x)
        setError(null)
      } catch (e: any) {
        if (!alive.current) return
        setError(String(e?.message ?? e))
      } finally {
        if (!alive.current) return
        setLoading(false)
      }
    }

    run()
    const id = setInterval(run, intervalMs)
    return () => {
      alive.current = false
      clearInterval(id)
    }
  }, [intervalMs])

  return { data, error, loading }
}
