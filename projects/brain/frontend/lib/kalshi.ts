import * as crypto from 'node:crypto'

type FetchInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> }

async function fetchJson(method: string, path: string, body?: any): Promise<any> {
  const apiPrefix = '/trade-api/v2'
  const p0 = path.startsWith('/') ? path : `/${path}`
  const p = p0.startsWith('/trade-api/') ? p0 : `${apiPrefix}${p0}`

  const fullUrl = `${baseUrl()}${p}`
  const url = new URL(fullUrl)
  const fullPath = url.pathname + url.search

  const init: FetchInit = {
    method,
    cache: 'no-store',
    headers: signHeaders(method, fullPath),
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  const res = await fetch(fullUrl, init)
  const text = await res.text()
  let j: any
  try {
    j = text ? JSON.parse(text) : null
  } catch {
    j = text
  }
  if (!res.ok) {
    throw new Error(`Kalshi ${res.status}: ${typeof j === 'string' ? j : JSON.stringify(j)}`)
  }
  return j
}

function baseUrl(): string {
  return (process.env.KALSHI_BASE_URL ?? 'https://demo-api.kalshi.co').replace(/\/$/, '')
}

function normalizePem(raw: string): string {
  return String(raw)
    .replace(/^\uFEFF/, '')
    .replace(/\\n/g, '\n')
    .trim()
}

function keyId(): string {
  const id = process.env.KALSHI_DEMO_KEY_ID
  if (!id) throw new Error('Missing KALSHI_DEMO_KEY_ID')
  return id.trim()
}

function privateKeyObject(): crypto.KeyObject {
  const pem = normalizePem(process.env.KALSHI_DEMO_PRIVATE_KEY ?? '')
  if (!pem) throw new Error('Missing KALSHI_DEMO_PRIVATE_KEY')
  return crypto.createPrivateKey({ key: pem, format: 'pem' })
}

function signHeaders(method: string, pathWithOptionalQuery: string): Record<string, string> {
  const timestamp = Date.now().toString() // ms
  const path = pathWithOptionalQuery.split('?')[0]
  const msg = timestamp + method.toUpperCase() + path

  const signature = crypto.sign('sha256', Buffer.from(msg), {
    key: privateKeyObject(),
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  })

  return {
    'KALSHI-ACCESS-KEY': keyId(),
    'KALSHI-ACCESS-SIGNATURE': signature.toString('base64'),
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'content-type': 'application/json',
  }
}

export async function getBalance() {
  return await fetchJson('GET', '/portfolio/balance')
}

export async function getOrdersOpen() {
  const url = new URL('http://local/portfolio/orders')
  url.searchParams.set('status', 'open')
  return await fetchJson('GET', url.pathname + url.search)
}
