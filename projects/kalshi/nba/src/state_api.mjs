import fs from 'node:fs';
import path from 'node:path';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function safeReadLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const txt = fs.readFileSync(filePath, 'utf8');
  return txt.split(/\r?\n/).filter(Boolean);
}

function computePnl({ entryPriceC, exitPriceC, qty, feeRateOnWinnings = 0.01 }) {
  if (![entryPriceC, exitPriceC, qty].every(Number.isFinite)) return null;
  const gross = (exitPriceC - entryPriceC) * qty / 100;
  const winnings = exitPriceC > entryPriceC ? (exitPriceC - entryPriceC) * qty / 100 : 0;
  const fees = winnings * feeRateOnWinnings;
  return { gross, fees, net: gross - fees };
}

export function loadStateFromJsonl({
  logsDir,
  isoDate = todayIso(),
  startingCapitalUsd = 0,
  feeRateOnWinnings = 0.01,
} = {}) {
  const file = path.join(logsDir, `${isoDate}.jsonl`);
  const lines = safeReadLines(file);

  // Load persisted bot state (baseline lock, favoriteTeam, etc.) if present.
  const stateFile = path.join(logsDir, 'state.json');
  let persisted = null;
  try {
    if (fs.existsSync(stateFile)) persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    persisted = null;
  }

  const games = new Map(); // gameId -> { gameId, parsed, lastMarket, lastEspn, ... }
  const skipReasonCounts = {};
  const orders = new Map();
  const positions = new Map(); // gameId -> open position
  const closed = [];

  for (const ln of lines) {
    let o;
    try { o = JSON.parse(ln); } catch { continue; }

    // skip reason counts
    if (o.type === 'entry_check' && o.ok === false) {
      const r = o.skip_reason || 'unknown';
      skipReasonCounts[r] = (skipReasonCounts[r] || 0) + 1;
    }

    // game snapshots
    if (o.type === 'market_snapshot' && o.gameId) {
      const g = games.get(o.gameId) || { gameId: o.gameId };
      g.parsed = o.parsed || g.parsed;
      g.lastMarketAt = o.t || g.lastMarketAt;
      g.markets = g.markets || {};
      g.markets[o.ticker] = {
        ticker: o.ticker,
        midProb: o.midProb,
        tob: o.tob,
        depthNearMid: o.depthYesNearMid,
        spreadC: o.tob?.spreadC ?? null,
      };
      games.set(o.gameId, g);
    }

    // espn game state
    if ((o.type === 'game_state_fallback' || o.type === 'game_state') && o.gameId) {
      // We only really want ESPN (provider=espn) state for display.
      if (o.provider === 'espn' && o.ok) {
        const g = games.get(o.gameId) || { gameId: o.gameId };
        g.lastEspnAt = o.updatedAtMs || o.t || g.lastEspnAt;
        g.espn = {
          quarter: o.quarter,
          clockDisplay: o.clockDisplay,
          clockSec: o.clockSec,
          homeScore: o.homeScore,
          awayScore: o.awayScore,
          state: o.state,
          scheduledStartIso: o.scheduledStartIso,
          scheduledStartMs: o.scheduledStartMs,
        };
        games.set(o.gameId, g);
      }
    }

    // paper trading
    if (o.type === 'paper_order_placed') {
      orders.set(o.id, o);
    }
    if (o.type === 'paper_order_cancelled') {
      const ord = orders.get(o.orderId);
      if (ord) ord.status = 'cancelled';
    }
    if (o.type === 'paper_fill') {
      // open position for that game
      positions.set(o.gameId, {
        gameId: o.gameId,
        ticker: o.ticker,
        qty: o.qty,
        entryPriceC: o.priceC,
        openedAtMs: o.filledAtMs,
      });
    }
    if (o.type === 'paper_position_closed') {
      const pnl = computePnl({
        entryPriceC: o.entryPriceC,
        exitPriceC: o.exitPriceC,
        qty: o.qty,
        feeRateOnWinnings,
      });
      closed.push({
        gameId: o.gameId,
        ticker: o.ticker,
        qty: o.qty,
        entryPriceC: o.entryPriceC,
        exitPriceC: o.exitPriceC,
        exitReason: o.exitReason,
        openedAtMs: o.openedAtMs,
        closedAtMs: o.closedAtMs,
        pnl,
      });
      positions.delete(o.gameId);
    }
  }

  const liveGames = [];
  for (const g of games.values()) {
    const p = g.parsed;
    const espn = g.espn;

    // pick probabilities by team ticker suffix
    const probs = {};
    if (p?.ok && g.markets) {
      for (const m of Object.values(g.markets)) {
        const team = String(m.ticker).split('-').at(-1);
        probs[team] = m.midProb;
      }
    }

    const ps = persisted?.games?.[g.gameId] || null;

    liveGames.push({
      gameId: g.gameId,
      date: p?.date || null,
      away: p?.away || null,
      home: p?.home || null,
      espn,
      probs,
      pregame: ps?.pregameLockedProb ? {
        prob: ps.pregameLockedProb,
        favoriteTeam: ps.favoriteTeam || null,
        lockedAtMs: ps.pregameLockedAtMs || null,
      } : null,
    });
  }

  // capital
  const realized = closed.reduce((a, t) => a + (t.pnl?.net || 0), 0);
  const capitalUsd = startingCapitalUsd + realized;

  return {
    ok: true,
    isoDate,
    sourceFile: file,
    updatedAtMs: Date.now(),
    capital: {
      startingUsd: startingCapitalUsd,
      realizedPnlUsd: realized,
      currentUsd: capitalUsd,
    },
    liveGames,
    openPositions: Array.from(positions.values()),
    todaysTrades: closed,
    skipReasonCounts,
  };
}
