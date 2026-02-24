import 'dotenv/config';

import type { OrderRecord } from '../../types';

import { estimateSlippage, isTradeableMarket, simulateFill } from './execution_compute';

const PAPER_TRADING = process.env.EXECUTION_MODE !== 'live';

function nowIso() {
  return new Date().toISOString();
}

export async function placeOrder(order: Partial<OrderRecord> & { openInterest: number }): Promise<OrderRecord> {
  if (!PAPER_TRADING) throw new Error('Live trading not yet enabled');

  if (!order.order_id) order.order_id = cryptoRandomId();

  const limitPrice = Number(order.limit_price ?? 0);
  const side = order.side as 'yes' | 'no';
  const size = Number(order.size ?? 0);

  const sim = simulateFill(limitPrice, side, order.openInterest);

  return {
    order_id: String(order.order_id),
    bot_id: String(order.bot_id ?? 'execution-bot-1'),
    market_ticker: String(order.market_ticker ?? ''),
    market_type: (order.market_type ?? 'prediction') as any,
    order_type: (order.order_type ?? 'limit') as any,
    side,
    size,
    limit_price: Number.isFinite(limitPrice) ? limitPrice : null,
    fill_price: sim.fillPrice,
    fill_size: size,
    status: sim.status,
    slippage: sim.slippage,
    attempt_count: Number(order.attempt_count ?? 1),
    created_at: order.created_at ?? nowIso(),
    filled_at: nowIso(),
  };
}

export function handlePartialFill(
  existing: OrderRecord,
  currentSpread: number,
  avgSpread: number,
): { action: 'retry' | 'accept_partial' | 'abandon'; reason: string } {
  if (existing.attempt_count >= 3) return { action: 'abandon', reason: 'max_attempts_reached' };
  if (Number(currentSpread) > Number(avgSpread) * 2) return { action: 'accept_partial', reason: 'spread_too_wide_to_retry' };
  return { action: 'retry', reason: 'retry_remaining_fill' };
}

export function evaluateExit(
  fillPrice: number,
  currentPrice: number,
  stopLevel: number,
  profitTarget: number,
  side: 'yes' | 'no',
): { action: 'hold' | 'exit'; reason: string } {
  if (side === 'yes') {
    if (Number(currentPrice) >= Number(profitTarget)) return { action: 'exit', reason: 'profit_target_hit' };
    if (Number(currentPrice) <= Number(stopLevel)) return { action: 'exit', reason: 'stop_hit' };
    return { action: 'hold', reason: 'within_bands' };
  }

  // side === 'no'
  if (Number(currentPrice) <= Number(profitTarget)) return { action: 'exit', reason: 'profit_target_hit' };
  if (Number(currentPrice) >= Number(stopLevel)) return { action: 'exit', reason: 'stop_hit' };
  return { action: 'hold', reason: 'within_bands' };
}

function cryptoRandomId(): string {
  // minimal uuid-ish for paper mode
  return `ord_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}
