// Orderbook helpers for Kalshi YES/NO markets.

function bestBid(levels) {
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const [p, q] = levels[0];
  return { priceC: Number(p), qty: Number(q) };
}

export function computeTopOfBook(orderbookResp) {
  const yes = orderbookResp?.orderbook?.yes;
  const no = orderbookResp?.orderbook?.no;

  const yb = bestBid(yes);
  const nb = bestBid(no);

  // implied asks (cents) from opposite best bids
  const ya = (nb && Number.isFinite(nb.priceC)) ? (100 - nb.priceC) : null;
  const na = (yb && Number.isFinite(yb.priceC)) ? (100 - yb.priceC) : null;

  const midC = (yb && ya != null) ? Math.round((yb.priceC + ya) / 2) : null;
  const spreadC = (yb && ya != null) ? (ya - yb.priceC) : null;

  // Locked probability definition in cents:
  // midC = round((YES_best_bid + (100 - NO_best_bid)) / 2)
  const midLockedC = (yb && nb) ? Math.round((yb.priceC + (100 - nb.priceC)) / 2) : null;

  return { yb, nb, ya, na, midC, midLockedC, spreadC };
}

export function depthNearMid(orderbookResp, { side = 'yes', midC, nearC = 1 } = {}) {
  const book = orderbookResp?.orderbook?.[side];
  if (!Array.isArray(book) || book.length === 0) return 0;
  if (!Number.isFinite(midC)) return 0;

  let depth = 0;
  for (const [p, q] of book) {
    const pc = Number(p);
    const qc = Number(q);
    if (!Number.isFinite(pc) || !Number.isFinite(qc)) continue;
    if (Math.abs(pc - midC) <= nearC) depth += qc;
  }
  return depth;
}
