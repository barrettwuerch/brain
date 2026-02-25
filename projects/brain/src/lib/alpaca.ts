import 'dotenv/config';

export type AlpacaAccount = {
  id: string;
  status: string;
  currency: string;
  cash: string;
  portfolio_value: string;
  buying_power: string;
  equity: string;
  pattern_day_trader: boolean;
};

export type AlpacaPosition = {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  side: 'long' | 'short';
};

export type AlpacaOrder = {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;

  symbol: string;
  qty: string;
  filled_qty: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit' | string;
  time_in_force: 'day' | 'gtc' | 'ioc' | 'fok' | string;

  limit_price?: string | null;
  stop_price?: string | null;

  status: string;
};

export type OrderParams = {
  symbol: string;
  qty?: string;
  notional?: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop_limit';
  time_in_force: 'day' | 'gtc' | 'ioc';
  limit_price?: string;
  stop_price?: string;
  client_order_id?: string; // use this to tag orders with task_id
};

export type Bar = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Quote = {
  bid: number;
  ask: number;
  spread: number;
  timestamp: string;
};

function reqEnv(name: string): string {
  const v = String(process.env[name] ?? '').trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const BASE_URL = (() => {
  const raw = reqEnv('ALPACA_BASE_URL');
  return raw.replace(/\/$/, '');
})();

const DATA_URL = 'https://data.alpaca.markets';

function authHeaders(): Record<string, string> {
  return {
    'APCA-API-KEY-ID': reqEnv('ALPACA_API_KEY'),
    'APCA-API-SECRET-KEY': reqEnv('ALPACA_SECRET_KEY'),
    'content-type': 'application/json',
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(url, init);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`alpaca fetch failed ${resp.status} for ${url}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Broker API (authenticated)
// ─────────────────────────────────────────────────────────────────────────────

export async function getAccount(): Promise<AlpacaAccount> {
  const j = await fetchJson(`${BASE_URL}/v2/account`, {
    method: 'GET',
    headers: authHeaders(),
  });

  return {
    id: String(j.id),
    status: String(j.status),
    currency: String(j.currency),
    cash: String(j.cash),
    portfolio_value: String(j.portfolio_value),
    buying_power: String(j.buying_power),
    equity: String(j.equity),
    pattern_day_trader: Boolean(j.pattern_day_trader),
  };
}

export async function getPositions(): Promise<AlpacaPosition[]> {
  const j = await fetchJson(`${BASE_URL}/v2/positions`, {
    method: 'GET',
    headers: authHeaders(),
  });
  const rows = Array.isArray(j) ? j : [];
  return rows.map((p: any) => ({
    asset_id: String(p.asset_id),
    symbol: String(p.symbol),
    exchange: String(p.exchange),
    asset_class: String(p.asset_class),
    qty: String(p.qty),
    avg_entry_price: String(p.avg_entry_price),
    current_price: String(p.current_price),
    market_value: String(p.market_value),
    unrealized_pl: String(p.unrealized_pl),
    unrealized_plpc: String(p.unrealized_plpc),
    side: String(p.side) === 'short' ? 'short' : 'long',
  }));
}

export async function getOpenOrders(): Promise<AlpacaOrder[]> {
  const j = await fetchJson(`${BASE_URL}/v2/orders?status=open&direction=desc&limit=500`, {
    method: 'GET',
    headers: authHeaders(),
  });
  const rows = Array.isArray(j) ? j : [];
  return rows.map(toOrder);
}

export async function getOrder(orderId: string): Promise<AlpacaOrder> {
  const j = await fetchJson(`${BASE_URL}/v2/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  return toOrder(j);
}

export async function cancelOrder(orderId: string): Promise<void> {
  await fetchJson(`${BASE_URL}/v2/orders/${encodeURIComponent(orderId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function placeOrder(params: OrderParams): Promise<AlpacaOrder> {
  if (!params.qty && !params.notional) throw new Error('placeOrder requires qty or notional');

  const body: any = {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
    time_in_force: params.time_in_force,
    client_order_id: params.client_order_id,
  };

  if (params.qty) body.qty = params.qty;
  if (params.notional) body.notional = params.notional;
  if (params.limit_price) body.limit_price = params.limit_price;
  if (params.stop_price) body.stop_price = params.stop_price;

  const j = await fetchJson(`${BASE_URL}/v2/orders`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  return toOrder(j);
}

function toOrder(o: any): AlpacaOrder {
  return {
    id: String(o.id),
    client_order_id: String(o.client_order_id ?? ''),
    created_at: String(o.created_at ?? ''),
    updated_at: String(o.updated_at ?? ''),
    submitted_at: String(o.submitted_at ?? ''),
    filled_at: o.filled_at ? String(o.filled_at) : null,
    expired_at: o.expired_at ? String(o.expired_at) : null,
    canceled_at: o.canceled_at ? String(o.canceled_at) : null,
    failed_at: o.failed_at ? String(o.failed_at) : null,

    symbol: String(o.symbol),
    qty: String(o.qty ?? ''),
    filled_qty: String(o.filled_qty ?? ''),
    side: String(o.side) === 'sell' ? 'sell' : 'buy',
    type: String(o.type ?? ''),
    time_in_force: String(o.time_in_force ?? ''),

    limit_price: o.limit_price != null ? String(o.limit_price) : null,
    stop_price: o.stop_price != null ? String(o.stop_price) : null,

    status: String(o.status ?? ''),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Data API (public)
// ─────────────────────────────────────────────────────────────────────────────

export async function getCryptoBars(symbol: string, timeframe: '1h' | '4h' | '1d', limit: number): Promise<Bar[]> {
  const url = new URL(DATA_URL + '/v1beta3/crypto/us/bars');
  url.searchParams.set('symbols', symbol);
  const tf = timeframe === '1h' ? '1Hour' : timeframe === '4h' ? '4Hour' : '1Day';
  url.searchParams.set('timeframe', tf);
  url.searchParams.set('limit', String(limit));

  const j = await fetchJson(url.toString(), { method: 'GET' });
  const bars = (j?.bars?.[symbol] ?? []) as any[];

  return bars
    .map((b) => ({
      timestamp: String(b.t ?? b.timestamp),
      open: Number(b.o),
      high: Number(b.h),
      low: Number(b.l),
      close: Number(b.c),
      volume: Number(b.v),
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export async function getLatestQuote(symbol: string): Promise<Quote> {
  const url = new URL(DATA_URL + '/v1beta3/crypto/us/latest/quotes');
  url.searchParams.set('symbols', symbol);
  const j = await fetchJson(url.toString(), { method: 'GET' });
  const q = (j?.quotes?.[symbol] ?? null) as any;
  if (!q) throw new Error(`Missing quote for ${symbol}`);

  const bid = Number(q.bp ?? q.bid_price);
  const ask = Number(q.ap ?? q.ask_price);
  return {
    bid,
    ask,
    spread: ask - bid,
    timestamp: String(q.t ?? q.timestamp),
  };
}

export async function getLatestStockTradePrice(symbol: string): Promise<{ price: number; timestamp: string }> {
  // Alpaca Data API v2 for stocks
  const url = `${DATA_URL}/v2/stocks/${encodeURIComponent(symbol)}/trades/latest`;
  const j = await fetchJson(url, { method: 'GET', headers: authHeaders() });
  const t = (j?.trade ?? j?.data ?? j) as any;
  const price = Number(t?.p ?? t?.price);
  const timestamp = String(t?.t ?? t?.timestamp ?? '');
  if (!Number.isFinite(price)) throw new Error(`Missing stock trade price for ${symbol}`);
  return { price, timestamp };
}
