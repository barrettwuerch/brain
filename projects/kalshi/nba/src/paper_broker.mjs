import { nowMs } from './util.mjs';

/**
 * v0 paper broker
 * - all-or-nothing fills
 * - supports: placeLimit, cancel, pollFill
 */
export class PaperBroker {
  constructor({ log }) {
    this.log = log;
    this.orders = new Map();
    this.positions = new Map(); // gameId -> position
    this.nextId = 1;
  }

  hasTradedGame(gameId) {
    return this.positions.has(gameId);
  }

  hasOpenOrderForGame(gameId) {
    for (const o of this.orders.values()) {
      if (o.gameId === gameId && o.status === 'open') return true;
    }
    return false;
  }

  getPosition(gameId) {
    return this.positions.get(gameId) || null;
  }

  placeLimit({ gameId, ticker, side, priceC, qty, goodForMs }) {
    const id = `paper_${this.nextId++}`;
    const o = {
      id,
      gameId,
      ticker,
      side,
      priceC,
      qty,
      status: 'open',
      createdAtMs: nowMs(),
      expiresAtMs: nowMs() + goodForMs,
    };
    this.orders.set(id, o);
    this.log?.write?.({ t: nowMs(), type: 'paper_order_placed', ...o });
    return o;
  }

  cancel(orderId, reason = 'cancel') {
    const o = this.orders.get(orderId);
    if (!o) return null;
    this.orders.delete(orderId);
    this.log?.write?.({ t: nowMs(), type: 'paper_order_cancelled', orderId, reason });
    return o;
  }

  /**
   * Decide whether an order fills, given top-of-book.
   * v0: fill only if our limit crosses the implied ask.
   */
  pollFill(orderId, { tob }) {
    const o = this.orders.get(orderId);
    if (!o) return { status: 'missing' };
    if (nowMs() >= o.expiresAtMs) {
      this.cancel(orderId, 'expired');
      return { status: 'expired' };
    }

    const impliedYesAsk = tob?.ya; // cents
    if (!Number.isFinite(impliedYesAsk)) return { status: 'open' };

    if (o.side === 'YES' && o.priceC >= impliedYesAsk) {
      this.orders.delete(orderId);
      const fill = { orderId, filledAtMs: nowMs(), priceC: impliedYesAsk, qty: o.qty };
      this.log?.write?.({ t: nowMs(), type: 'paper_fill', gameId: o.gameId, ticker: o.ticker, side: o.side, ...fill });

      // open position keyed by game (one position max in v0)
      this.positions.set(o.gameId, {
        gameId: o.gameId,
        ticker: o.ticker,
        side: o.side,
        entryPriceC: impliedYesAsk,
        qty: o.qty,
        openedAtMs: fill.filledAtMs,
        status: 'open',
      });
      return { status: 'filled', fill };
    }

    return { status: 'open' };
  }

  closePosition({ gameId, exitPriceC, reason }) {
    const p = this.positions.get(gameId);
    if (!p || p.status !== 'open') return null;
    p.status = 'closed';
    p.exitPriceC = exitPriceC;
    p.exitReason = reason;
    p.closedAtMs = nowMs();
    this.log?.write?.({ t: nowMs(), type: 'paper_position_closed', ...p });
    return p;
  }
}
