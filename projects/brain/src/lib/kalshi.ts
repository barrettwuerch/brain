import 'dotenv/config';

import crypto from 'node:crypto';

export type KalshiBalance = {
  balance: number; // cents
  payout: number; // cents
};

export type KalshiPosition = {
  ticker: string;
  position: number;
  avg_price: number;
  realized_pnl: number;
  unrealized_pnl: number;
};

export type KalshiMarket = {
  ticker: string;
  title: string;
  status: string;
  yes_bid: number;
  yes_ask: number;
  volume: number;
  close_time: string;
};

export type KalshiOrderbook = {
  ticker: string;
  yes: { bids: Array<{ price: number; count: number }>; asks: Array<{ price: number; count: number }> };
  no: { bids: Array<{ price: number; count: number }>; asks: Array<{ price: number; count: number }> };
};

export type KalshiOrderParams = {
  ticker: string;
  client_order_id: string; // tag with task.id
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  type: 'limit' | 'market';
  count: number;
  yes_price?: number; // cents (1-99)
  no_price?: number; // cents (1-99)
};

export type KalshiOrder = {
  id: string;
  client_order_id: string;
  ticker: string;
  status: string;
  created_time: string;
  side: string;
  action: string;
  type: string;
  count: number;
  yes_price?: number;
  no_price?: number;
};

function reqEnv(name: string): string {
  const v = String(process.env[name] ?? '').trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

type KalshiEnv = 'demo' | 'prod';

function kalshiEnv(): KalshiEnv {
  const v = String(process.env.KALSHI_ENV ?? 'prod').trim().toLowerCase();
  return v === 'demo' ? 'demo' : 'prod';
}

function baseUrl(): string {
  // Allow explicit override, but otherwise pick a sensible default by env.
  const override = String(process.env.KALSHI_BASE_URL ?? '').trim();
  if (override) return override.replace(/\/$/, '');

  if (kalshiEnv() === 'demo') return 'https://demo-api.kalshi.co';
  // Current docs/examples for production use api.elections.kalshi.com.
  return 'https://api.elections.kalshi.com';
}

function normalizePemFromEnvVar(name: string): string {
  // Stored in .env as a single line with \n escapes.
  // Normalize aggressively because PEM parsing is sensitive to BOM + whitespace + newline encoding.
  const raw = String(process.env[name] ?? '');
  return raw
    .replace(/^\uFEFF/, '') // strip UTF-8 BOM if present
    .replace(/\\n/g, '\n') // convert literal "\\n" sequences into real newlines
    .trim(); // remove leading/trailing whitespace/newlines
}

function accessKeyId(): string {
  return kalshiEnv() === 'demo' ? reqEnv('KALSHI_DEMO_KEY_ID') : reqEnv('KALSHI_KEY_ID');
}

function privateKeyPem(): string {
  return kalshiEnv() === 'demo'
    ? normalizePemFromEnvVar('KALSHI_DEMO_PRIVATE_KEY')
    : normalizePemFromEnvVar('KALSHI_PRIVATE_KEY');
}

function privateKeyObject(): crypto.KeyObject {
  // Explicitly parse PEM into a KeyObject (some runtimes behave differently signing with raw strings).
  return crypto.createPrivateKey({
    key: privateKeyPem(),
    format: 'pem',
  });
}

function signHeaders(method: string, pathWithOptionalQuery: string): Record<string, string> {
  // Kalshi expects timestamp in *milliseconds*.
  const timestamp = Date.now().toString();

  // Important: sign the path WITHOUT query parameters.
  const path = pathWithOptionalQuery.split('?')[0];

  const msg = timestamp + method.toUpperCase() + path;

  const signature = crypto.sign('sha256', Buffer.from(msg), {
    key: privateKeyObject(),
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });

  return {
    'KALSHI-ACCESS-KEY': accessKeyId(),
    'KALSHI-ACCESS-SIGNATURE': signature.toString('base64'),
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'content-type': 'application/json',
  };
}

async function fetchJson(method: string, path: string, body?: any): Promise<any> {
  const apiPrefix = '/trade-api/v2';
  const p0 = path.startsWith('/') ? path : `/${path}`;
  const p = p0.startsWith('/trade-api/') ? p0 : `${apiPrefix}${p0}`;

  const fullUrl = `${baseUrl()}${p}`;
  const url = new URL(fullUrl);
  const fullPath = url.pathname + url.search;

  const resp = await fetch(url.toString(), {
    method,
    headers: signHeaders(method, fullPath),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Kalshi error ${resp.status} for ${method} ${fullPath}: ${text.slice(0, 600)}`);
  }

  return text ? JSON.parse(text) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio
// ─────────────────────────────────────────────────────────────────────────────

export async function getBalance(): Promise<KalshiBalance> {
  const j = await fetchJson('GET', '/portfolio/balance');
  const b = (j?.balance ?? j) as any;
  return {
    balance: Number(b?.balance ?? b?.cash_balance ?? 0),
    payout: Number(b?.payout ?? b?.payout_balance ?? 0),
  };
}

export async function getPositions(): Promise<KalshiPosition[]> {
  const j = await fetchJson('GET', '/portfolio/positions');
  const rows = (j?.positions ?? j) as any[];
  return (rows ?? []).map((p: any) => ({
    ticker: String(p.ticker),
    position: Number(p.position ?? p.count ?? 0),
    avg_price: Number(p.avg_price ?? 0),
    realized_pnl: Number(p.realized_pnl ?? 0),
    unrealized_pnl: Number(p.unrealized_pnl ?? 0),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Markets
// ─────────────────────────────────────────────────────────────────────────────

export async function getMarkets(params?: {
  series_ticker?: string;
  status?: string;
  limit?: number;
}): Promise<KalshiMarket[]> {
  const url = new URL(`${BASE_URL}/markets`);
  if (params?.series_ticker) url.searchParams.set('series_ticker', params.series_ticker);
  if (params?.status) url.searchParams.set('status', params.status);
  if (params?.limit) url.searchParams.set('limit', String(params.limit));

  const j = await fetchJson('GET', url.pathname + url.search);
  const rows = (j?.markets ?? j) as any[];
  return (rows ?? []).map(toMarket);
}

export async function getMarket(ticker: string): Promise<KalshiMarket> {
  const j = await fetchJson('GET', `/markets/${encodeURIComponent(ticker)}`);
  const m = (j?.market ?? j) as any;
  return toMarket(m);
}

export async function getOrderbook(ticker: string): Promise<KalshiOrderbook> {
  const j = await fetchJson('GET', `/markets/${encodeURIComponent(ticker)}/orderbook`);
  const ob = (j?.orderbook ?? j) as any;
  return {
    ticker,
    yes: { bids: (ob?.yes?.bids ?? []).map(toLevel), asks: (ob?.yes?.asks ?? []).map(toLevel) },
    no: { bids: (ob?.no?.bids ?? []).map(toLevel), asks: (ob?.no?.asks ?? []).map(toLevel) },
  };
}

function toLevel(l: any) {
  return { price: Number(l.price ?? l[0] ?? 0), count: Number(l.count ?? l[1] ?? 0) };
}

function toMarket(m: any): KalshiMarket {
  return {
    ticker: String(m.ticker),
    title: String(m.title ?? ''),
    status: String(m.status ?? ''),
    yes_bid: Number(m.yes_bid ?? m.yes_bid_price ?? 0),
    yes_ask: Number(m.yes_ask ?? m.yes_ask_price ?? 0),
    volume: Number(m.volume ?? m.volume_24h ?? 0),
    close_time: String(m.close_time ?? m.close_ts ?? ''),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────────────────────

export async function placeOrder(params: KalshiOrderParams): Promise<KalshiOrder> {
  const body: any = {
    ticker: params.ticker,
    client_order_id: params.client_order_id,
    side: params.side,
    action: params.action,
    type: params.type,
    count: params.count,
  };

  if (params.yes_price !== undefined) body.yes_price = params.yes_price;
  if (params.no_price !== undefined) body.no_price = params.no_price;

  const j = await fetchJson('POST', '/orders', body);
  const o = (j?.order ?? j) as any;
  return toOrder(o);
}

export async function getOrders(params?: { ticker?: string; status?: string }): Promise<KalshiOrder[]> {
  const url = new URL(`${BASE_URL}/orders`);
  if (params?.ticker) url.searchParams.set('ticker', params.ticker);
  if (params?.status) url.searchParams.set('status', params.status);

  const j = await fetchJson('GET', url.pathname + url.search);
  const rows = (j?.orders ?? j) as any[];
  return (rows ?? []).map(toOrder);
}

export async function getOrder(orderId: string): Promise<KalshiOrder> {
  const j = await fetchJson('GET', `/orders/${encodeURIComponent(orderId)}`);
  const o = (j?.order ?? j) as any;
  return toOrder(o);
}

export async function cancelOrder(orderId: string): Promise<void> {
  await fetchJson('DELETE', `/orders/${encodeURIComponent(orderId)}`);
}

function toOrder(o: any): KalshiOrder {
  return {
    id: String(o.id ?? o.order_id ?? ''),
    client_order_id: String(o.client_order_id ?? ''),
    ticker: String(o.ticker ?? ''),
    status: String(o.status ?? ''),
    created_time: String(o.created_time ?? o.created_at ?? ''),
    side: String(o.side ?? ''),
    action: String(o.action ?? ''),
    type: String(o.type ?? ''),
    count: Number(o.count ?? 0),
    yes_price: o.yes_price !== undefined ? Number(o.yes_price) : undefined,
    no_price: o.no_price !== undefined ? Number(o.no_price) : undefined,
  };
}
