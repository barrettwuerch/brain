type FetchInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> }

async function fetchJson(url: string, init: FetchInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  })
  const text = await res.text()
  let j: any
  try {
    j = text ? JSON.parse(text) : null
  } catch {
    j = text
  }
  if (!res.ok) {
    throw new Error(`Alpaca ${res.status}: ${typeof j === 'string' ? j : JSON.stringify(j)}`)
  }
  return j
}

function baseUrl(): string {
  return (process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets').replace(/\/$/, '')
}

function authHeaders() {
  const key = process.env.ALPACA_API_KEY
  const secret = process.env.ALPACA_SECRET_KEY
  if (!key || !secret) throw new Error('Missing ALPACA_API_KEY/ALPACA_SECRET_KEY')
  return {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
    'content-type': 'application/json',
  }
}

export async function getAccount() {
  return await fetchJson(`${baseUrl()}/v2/account`, { method: 'GET', headers: authHeaders() })
}

export async function getPositions() {
  return await fetchJson(`${baseUrl()}/v2/positions`, { method: 'GET', headers: authHeaders() })
}
