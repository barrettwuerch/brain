export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers ?? {}),
    },
    ...init,
  })
}

export function jsonError(message: string, status: number = 500, extra?: Record<string, unknown>) {
  return json({ ok: false, error: message, ...(extra ?? {}) }, { status })
}
