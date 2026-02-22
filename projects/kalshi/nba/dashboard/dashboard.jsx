import React, { useState, useEffect, useRef } from "react";

const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@400;500&family=Barlow+Condensed:wght@400;600;700;900&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #0a0a0a;
    color: #fff;
    font-family: 'DM Mono', monospace;
    overflow-x: hidden;
  }

  :root {
    --red: #ff2d2d;
    --green: #00e87a;
    --dim: #333;
    --muted: #666;
    --card: #111;
    --border: #1f1f1f;
  }

  .grain {
    position: fixed; inset: 0; pointer-events: none; z-index: 100;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
    opacity: 0.4;
  }

  .dashboard { min-height: 100vh; padding: 0; position: relative; }

  /* HEADER */
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 24px 40px;
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 50;
    background: rgba(10,10,10,0.95);
    backdrop-filter: blur(20px);
  }
  .logo {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 28px;
    letter-spacing: 4px;
    color: #fff;
  }
  .logo span { color: var(--red); }
  .live-badge {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; letter-spacing: 2px; color: var(--green);
    font-family: 'DM Mono', monospace;
  }
  .live-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--green);
    animation: pulse 1.5s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.3); }
  }
  .header-right { display: flex; align-items: center; gap: 32px; }
  .header-stat { text-align: right; }
  .header-stat .val {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 22px; letter-spacing: 1px;
  }
  .header-stat .lbl { font-size: 9px; letter-spacing: 2px; color: var(--muted); }
  .green { color: var(--green); }
  .red { color: var(--red); }

  /* MAIN GRID */
  .main { padding: 32px 40px; display: grid; gap: 24px; }

  /* CAPITAL HERO */
  .capital-hero {
    background: var(--card);
    border: 1px solid var(--border);
    padding: 40px;
    position: relative;
    overflow: hidden;
  }
  .capital-hero::before {
    content: '';
    position: absolute; top: -60px; right: -60px;
    width: 300px; height: 300px;
    background: radial-gradient(circle, rgba(255,45,45,0.08) 0%, transparent 70%);
    pointer-events: none;
  }
  .capital-label {
    font-size: 10px; letter-spacing: 4px; color: var(--muted);
    margin-bottom: 12px;
  }
  .capital-value {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 80px; line-height: 1;
    letter-spacing: -2px;
    color: #fff;
  }
  .capital-delta {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 28px; font-weight: 700;
    margin-top: 8px;
  }
  .capital-sub {
    font-size: 11px; color: var(--muted); margin-top: 4px; letter-spacing: 1px;
  }
  .capital-stats {
    display: flex; gap: 48px; margin-top: 32px;
    border-top: 1px solid var(--border); padding-top: 24px;
  }
  .cstat { }
  .cstat .cv {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 28px; letter-spacing: 1px;
  }
  .cstat .cl { font-size: 9px; letter-spacing: 2px; color: var(--muted); }

  /* EQUITY CURVE */
  .equity-card {
    background: var(--card);
    border: 1px solid var(--border);
    padding: 28px;
  }
  .card-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 24px;
  }
  .card-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px; font-weight: 700;
    letter-spacing: 3px; text-transform: uppercase;
    color: var(--muted);
  }
  svg.chart { width: 100%; overflow: visible; }

  /* TWO COL */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; }

  /* LIVE GAMES */
  .game-card {
    background: var(--card);
    border: 1px solid var(--border);
    padding: 0;
    overflow: hidden;
    position: relative;
    transition: border-color 0.2s;
  }
  .game-card.active { border-color: var(--green); }
  .game-card.watching { border-color: rgba(255,45,45,0.4); }

  .game-header {
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
  }
  .game-status {
    font-size: 9px; letter-spacing: 2px;
    display: flex; align-items: center; gap: 6px;
  }
  .game-status.live { color: var(--green); }
  .game-status.pre { color: var(--muted); }
  .game-status-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: currentColor;
    animation: pulse 1.5s infinite;
  }
  .game-matchup {
    padding: 20px 20px 16px;
  }
  .team-row {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px;
  }
  .team-row:last-of-type { margin-bottom: 0; }
  .team-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 22px; font-weight: 900;
    letter-spacing: 1px;
    flex: 1;
  }
  .team-score {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 28px; margin: 0 16px;
    color: #fff;
  }
  .team-prob {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 22px; min-width: 52px; text-align: right;
  }
  .prob-bar-wrap { padding: 0 20px 20px; }
  .prob-bar-bg {
    height: 3px; background: var(--dim); position: relative;
    margin-bottom: 8px;
  }
  .prob-bar-fill {
    position: absolute; top: 0; left: 0; height: 100%;
    background: var(--green);
    transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .prob-bar-fill.red-fill { background: var(--red); }
  .flow-indicator {
    padding: 10px 20px;
    background: rgba(0,232,122,0.05);
    border-top: 1px solid var(--border);
    font-size: 10px; letter-spacing: 1px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .flow-indicator.in-position {
    background: rgba(0,232,122,0.08);
    border-top-color: rgba(0,232,122,0.3);
  }
  .flow-amount {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 16px;
  }

  /* TRADES TABLE */
  .trades-card {
    background: var(--card);
    border: 1px solid var(--border);
    padding: 28px;
  }
  .trade-row {
    display: grid;
    grid-template-columns: 1fr 80px 80px 80px 80px 100px;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    align-items: center;
    font-size: 12px;
  }
  .trade-row.header { color: var(--muted); font-size: 9px; letter-spacing: 2px; }
  .trade-row:last-child { border-bottom: none; }
  .trade-game {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 16px; font-weight: 700;
  }
  .trade-outcome {
    font-size: 9px; letter-spacing: 1px; padding: 3px 8px;
    display: inline-block;
  }
  .trade-outcome.win { background: rgba(0,232,122,0.15); color: var(--green); }
  .trade-outcome.loss { background: rgba(255,45,45,0.15); color: var(--red); }
  .trade-outcome.open { background: rgba(255,255,255,0.08); color: #fff; }

  /* METRICS */
  .metric-card {
    background: var(--card);
    border: 1px solid var(--border);
    padding: 28px;
    position: relative;
    overflow: hidden;
  }
  .metric-big {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 52px; letter-spacing: 1px;
    line-height: 1;
  }
  .metric-label {
    font-size: 9px; letter-spacing: 3px;
    color: var(--muted); margin-top: 8px;
  }
  .metric-sub {
    font-size: 11px; color: var(--muted); margin-top: 4px;
  }
  .streak-dots {
    display: flex; gap: 6px; margin-top: 16px;
  }
  .streak-dot {
    width: 10px; height: 10px; border-radius: 50%;
  }
  .streak-dot.w { background: var(--green); }
  .streak-dot.l { background: var(--red); }
  .streak-dot.empty { background: var(--dim); }

  /* SKIP REASONS */
  .skip-row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
  }
  .skip-row:last-child { border-bottom: none; }
  .skip-bar-bg { flex: 1; height: 2px; background: var(--dim); }
  .skip-bar-fill { height: 100%; background: var(--muted); }
  .skip-count {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 18px; color: var(--muted);
    min-width: 32px; text-align: right;
  }

  /* MONEY FLOW */
  .flow-card {
    background: var(--card);
    border: 1px solid var(--border);
    padding: 28px;
    grid-column: span 2;
  }

  .ticker-tape {
    overflow: hidden;
    border-top: 1px solid var(--border);
    padding: 12px 0;
    background: #0a0a0a;
  }
  .ticker-inner {
    display: flex; gap: 48px;
    animation: scroll 20s linear infinite;
    width: max-content;
  }
  @keyframes scroll {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  .ticker-item {
    font-size: 11px; letter-spacing: 1px;
    display: flex; align-items: center; gap: 8px;
    white-space: nowrap;
    color: var(--muted);
  }
  .ticker-item .team { color: #fff; font-weight: 500; }
  .ticker-item .prob { font-family: 'Bebas Neue', sans-serif; font-size: 14px; }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .fade-in { animation: fadeIn 0.5s ease forwards; }
  .fade-in-1 { animation-delay: 0.1s; opacity: 0; }
  .fade-in-2 { animation-delay: 0.2s; opacity: 0; }
  .fade-in-3 { animation-delay: 0.3s; opacity: 0; }
  .fade-in-4 { animation-delay: 0.4s; opacity: 0; }
  .fade-in-5 { animation-delay: 0.5s; opacity: 0; }
  .fade-in-6 { animation-delay: 0.6s; opacity: 0; }
`;

// ── Mock Data ──────────────────────────────────────────────────────────────────

const EQUITY_DATA = [
  50000, 50800, 49200, 51500, 53200, 52100, 54800, 56200, 55100,
  57400, 59100, 58200, 60800, 62100, 61300, 63500, 65200, 64100,
  66800, 68200, 67400, 69800, 71200, 70100, 72500, 74100, 73200,
  75800, 77400, 76100, 78200, 79800, 81200, 80400, 81940
];

const LIVE_GAMES = [
  { id: "BKNATL", away: "BKN", home: "ATL", awayScore: 52, homeScore: 61,
    awayProb: 0.26, homeProb: 0.74, quarter: 3, clock: "4:18",
    status: "live", position: null, pregame: { team: "ATL", prob: 0.72 } },
  { id: "DENGSW", away: "DEN", home: "GSW", awayScore: 61, homeScore: 68,
    awayProb: 0.35, homeProb: 0.65, quarter: 3, clock: "1:44",
    status: "live", position: { team: "DEN", entry: 0.42, size: 1800 }, pregame: { team: "DEN", prob: 0.68 } },
  { id: "BOSLAL", away: "BOS", home: "LAL", awayScore: 44, homeScore: 38,
    awayProb: 0.71, homeProb: 0.29, quarter: 2, clock: "8:55",
    status: "live", position: null, pregame: { team: "BOS", prob: 0.74 } },
  { id: "NYKCHI", away: "NYK", home: "CHI", awayScore: 0, homeScore: 0,
    awayProb: 0.67, homeProb: 0.33, quarter: 0, clock: "—",
    status: "pre", position: null, pregame: null },
];

const TRADES = [
  { game: "OKC vs LAL", team: "OKC", entry: "38¢", exit: "61¢", size: "$2,100", pnl: "+$497", outcome: "win", q: "Q2" },
  { game: "BOS vs PHI", team: "BOS", entry: "41¢", exit: "24¢", size: "$1,750", pnl: "-$298", outcome: "loss", q: "Q1" },
  { game: "MIL vs IND", team: "MIL", entry: "44¢", exit: "63¢", size: "$2,000", pnl: "+$380", outcome: "win", q: "Q2" },
  { game: "GSW vs SAC", team: "GSW", entry: "36¢", exit: "58¢", size: "$1,900", pnl: "+$418", outcome: "win", q: "Q3" },
  { game: "DEN vs GSW", team: "DEN", entry: "42¢", exit: "—", size: "$1,800", pnl: "open", outcome: "open", q: "Q3" },
];

const SKIP_REASONS = [
  { reason: "stale_game_state", count: 142, pct: 58 },
  { reason: "prob_out_of_window", count: 61, pct: 25 },
  { reason: "pregame_below_threshold", count: 24, pct: 10 },
  { reason: "spread_too_wide", count: 9, pct: 4 },
  { reason: "depth_too_low", count: 5, pct: 2 },
  { reason: "already_traded", count: 3, pct: 1 },
];

const TICKER_ITEMS = [
  { team: "OKC", prob: "73%", dir: "▲" }, { team: "BOS", prob: "71%", dir: "▲" },
  { team: "MIL", prob: "68%", dir: "▼" }, { team: "DEN", prob: "35%", dir: "▲" },
  { team: "ATL", prob: "74%", dir: "▲" }, { team: "GSW", prob: "65%", dir: "▼" },
  { team: "LAL", prob: "29%", dir: "▼" }, { team: "NYK", prob: "67%", dir: "▲" },
  { team: "MIA", prob: "52%", dir: "▲" }, { team: "PHX", prob: "48%", dir: "▼" },
];

// ── Equity Curve SVG ───────────────────────────────────────────────────────────

function EquityCurve({ data }) {
  const W = 900, H = 140, PAD = 10;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;

  const pts = data.map((v, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return [x, y];
  });

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
  const area = line + ` L ${pts[pts.length - 1][0]} ${H} L ${pts[0][0]} ${H} Z`;

  const lastPt = pts[pts.length - 1];

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} height={H}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00e87a" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#00e87a" stopOpacity="0" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d={area} fill="url(#areaGrad)" />
      <path d={line} fill="none" stroke="#00e87a" strokeWidth="2" filter="url(#glow)" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r="4" fill="#00e87a" filter="url(#glow)" />
      <line x1={lastPt[0]} y1={lastPt[1]} x2={lastPt[0]} y2={H}
        stroke="#00e87a" strokeWidth="1" strokeDasharray="3,3" opacity="0.3" />
    </svg>
  );
}

// ── Money Flow Bars ────────────────────────────────────────────────────────────

function MoneyFlowBars() {
  const bars = [
    { game: "BKN@ATL", team: "ATL", amount: 44200, pct: 88 },
    { game: "DEN@GSW", team: "DEN", amount: 31800, pct: 63 },
    { game: "BOS@LAL", team: "BOS", amount: 28500, pct: 57 },
    { game: "NYK@CHI", team: "NYK", amount: 19200, pct: 38 },
    { game: "MIA@PHX", team: "MIA", amount: 12800, pct: 26 },
  ];

  return (
    <div>
      {bars.map((b, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 11, letterSpacing: 1 }}>
            <span style={{ color: "#666" }}>{b.game}</span>
            <span style={{ color: "#fff", fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 13 }}>
              {b.team} · ${b.amount.toLocaleString()}
            </span>
          </div>
          <div style={{ height: 4, background: "#1f1f1f", position: "relative" }}>
            <div style={{
              position: "absolute", top: 0, left: 0, height: "100%",
              width: `${b.pct}%`,
              background: `linear-gradient(90deg, #00e87a, #00e87a88)`,
              transition: "width 1s cubic-bezier(0.4,0,0.2,1)"
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [api, setApi] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch('/api/state');
        const j = await r.json();
        if (!alive) return;
        if (j.ok) {
          setApi(j);
          setErr(null);
        } else {
          setErr(j.error || 'api error');
        }
      } catch (e) {
        if (!alive) return;
        setErr(String(e));
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const capital = api?.capital?.currentUsd ?? 50000;
  const starting = api?.capital?.startingUsd ?? 50000;
  const pnl = capital - starting;
  const pnlPct = ((pnl / starting) * 100).toFixed(1);
  const isPos = pnl >= 0;

  const games = (api?.liveGames || []).filter(g => g?.date === (api?.isoDate));
  const openPositions = api?.openPositions || [];
  const trades = api?.todaysTrades || [];
  const skipCounts = api?.skipReasonCounts || {};

  const tickerDouble = [...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <>
      <style>{STYLE}</style>
      <div className="grain" />
      <div className="dashboard">

        {/* TICKER TAPE */}
        <div className="ticker-tape">
          <div className="ticker-inner">
            {tickerDouble.map((t, i) => (
              <div className="ticker-item" key={i}>
                <span className="team">{t.team}</span>
                <span className={`prob ${parseFloat(t.prob) >= 65 ? "green" : parseFloat(t.prob) <= 40 ? "red" : ""}`}>
                  {t.prob}
                </span>
                <span style={{ color: t.dir === "▲" ? "#00e87a" : "#ff2d2d", fontSize: 10 }}>{t.dir}</span>
                <span style={{ color: "#1f1f1f", marginLeft: 16 }}>|</span>
              </div>
            ))}
          </div>
        </div>

        {/* HEADER */}
        <div className="header">
          <div className="logo">KXNBA<span>BOT</span></div>
          <div className="live-badge">
            <div className="live-dot" />
            PAPER MODE · ACTIVE
          </div>
          <div className="header-right">
            <div className="header-stat">
              <div className={`val ${isPos ? "green" : "red"}`}>
                {isPos ? "+" : ""}${Math.abs(pnl).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
              </div>
              <div className="lbl">SESSION P&L</div>
            </div>
            <div className="header-stat">
              <div className="val">{games.filter(g => g?.espn?.state === "in").length}</div>
              <div className="lbl">LIVE GAMES</div>
            </div>
            <div className="header-stat">
              <div className="val green">{openPositions.length}</div>
              <div className="lbl">OPEN POSITION</div>
            </div>
          </div>
        </div>

        {/* MAIN */}
        <div className="main">

          {/* CAPITAL HERO + EQUITY */}
          <div className="two-col fade-in fade-in-1">
            <div className="capital-hero">
              <div className="capital-label">TOTAL CAPITAL</div>
              <div className="capital-value">
                ${Math.floor(capital).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
              </div>
              <div className={`capital-delta ${isPos ? "green" : "red"}`}>
                {isPos ? "▲" : "▼"} {Math.abs(pnlPct)}% SINCE INCEPTION
              </div>
              <div className="capital-sub">Started at $50,000 · 6-month pilot</div>
              <div className="capital-stats">
                <div className="cstat">
                  <div className="cv green">66.6%</div>
                  <div className="cl">WIN RATE</div>
                </div>
                <div className="cstat">
                  <div className="cv">52</div>
                  <div className="cl">WINS</div>
                </div>
                <div className="cstat">
                  <div className="cv">26</div>
                  <div className="cl">LOSSES</div>
                </div>
                <div className="cstat">
                  <div className="cv red">-9.7%</div>
                  <div className="cl">MAX DD</div>
                </div>
              </div>
            </div>

            <div className="equity-card">
              <div className="card-header">
                <div className="card-title">EQUITY CURVE</div>
                <div style={{ fontSize: 11, color: "#666" }}>2025 NBA SEASON</div>
              </div>
              <EquityCurve data={EQUITY_DATA} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontSize: 10, color: "#666", letterSpacing: 1 }}>
                <span>$50,000</span>
                <span>78 TRADES</span>
                <span className="green">$81,940</span>
              </div>
            </div>
          </div>

          {/* LIVE GAMES */}
          <div>
            <div className="card-title" style={{ marginBottom: 16 }}>LIVE MARKETS</div>
            <div className="three-col fade-in fade-in-2" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
              {games.map((game) => {
                const ap = (game?.probs && game.away) ? (game.probs[game.away] ?? null) : null;
                const hp = (game?.probs && game.home) ? (game.probs[game.home] ?? null) : null;
                const pos = openPositions.find(p => p.gameId === game.gameId) || null;
                const hasPos = !!pos;
                const inWindow = (ap != null && ap >= 0.30 && ap <= 0.50) || (hp != null && hp >= 0.30 && hp <= 0.50);

                const status = game?.espn?.state === 'in' ? 'live' : 'pre';
                const quarter = game?.espn?.quarter ?? 0;
                const clock = game?.espn?.clockDisplay ?? '';
                const awayScore = game?.espn?.awayScore ?? 0;
                const homeScore = game?.espn?.homeScore ?? 0;

                return (
                  <div key={game.gameId} className={`game-card ${hasPos ? "active" : inWindow && status === "live" ? "watching" : ""}`}>
                    <div className="game-header">
                      <div className={`game-status ${status}`}>
                        {status === "live" && <div className="game-status-dot" />}
                        {status === "live" ? `Q${quarter} · ${clock}` : "PREGAME"}
                      </div>
                      <div style={{ fontSize: 9, color: "#444", letterSpacing: 1 }}>
                        {hasPos ? <span style={{ color: "#00e87a" }}>● POSITION</span> : inWindow && status === "live" ? <span style={{ color: "#ff6b6b" }}>◎ WATCHING</span> : "—"}
                      </div>
                    </div>
                    <div className="game-matchup">
                      <div className="team-row">
                        <div className="team-name">{game.away}</div>
                        <div className="team-score">{awayScore}</div>
                        <div className={`team-prob ${ap != null && ap >= 0.3 && ap <= 0.5 ? "red" : ap != null && ap >= 0.65 ? "green" : ""}`}>
                          {ap == null ? '—' : `${Math.round(ap * 100)}%`}
                        </div>
                      </div>
                      <div className="team-row">
                        <div className="team-name">{game.home}</div>
                        <div className="team-score">{homeScore}</div>
                        <div className={`team-prob ${hp != null && hp >= 0.3 && hp <= 0.5 ? "red" : hp != null && hp >= 0.65 ? "green" : ""}`}>
                          {hp == null ? '—' : `${Math.round(hp * 100)}%`}
                        </div>
                      </div>
                    </div>
                    <div className="prob-bar-wrap">
                      <div className="prob-bar-bg">
                        <div className="prob-bar-fill" style={{ width: `${(ap ?? 0) * 100}%` }} />
                      </div>
                    </div>
                    <div className={`flow-indicator ${hasPos ? "in-position" : ""}`}>
                      <span style={{ color: "#666" }}>
                        {hasPos ? `ENTRY ${pos.entryPriceC ?? '—'}¢` : game.pregame ? `PRE ${Math.round(game.pregame.prob * 100)}%` : "NO BASELINE"}
                      </span>
                      <span className={`flow-amount ${hasPos ? "green" : ""}`}>
                        {hasPos ? `$${((pos.qty || 0) * 1).toLocaleString()}` : "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* TRADES + SKIP REASONS */}
          <div className="two-col fade-in fade-in-3">
            <div className="trades-card">
              <div className="card-header">
                <div className="card-title">TRADE LOG</div>
                <div style={{ fontSize: 10, color: "#444", letterSpacing: 1 }}>TODAY · 5 TRADES</div>
              </div>
              <div className="trade-row header">
                <span>MATCHUP</span>
                <span>ENTRY</span>
                <span>EXIT</span>
                <span>SIZE</span>
                <span>QTR</span>
                <span>P&L</span>
              </div>
              {TRADES.map((t, i) => (
                <div className="trade-row" key={i}>
                  <div>
                    <div className="trade-game">{t.team}</div>
                    <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{t.game}</div>
                  </div>
                  <span style={{ color: "#888" }}>{t.entry}</span>
                  <span style={{ color: "#888" }}>{t.exit}</span>
                  <span style={{ color: "#888" }}>{t.size}</span>
                  <span style={{ color: "#888" }}>{t.q}</span>
                  <div>
                    <span className={`trade-outcome ${t.outcome}`}>
                      {t.outcome === "open" ? "OPEN" : t.outcome.toUpperCase()}
                    </span>
                    <div style={{
                      fontSize: 13, fontFamily: "'Bebas Neue'",
                      color: t.pnl.startsWith("+") ? "#00e87a" : t.pnl === "open" ? "#fff" : "#ff2d2d",
                      marginTop: 4
                    }}>{t.pnl}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="trades-card">
              <div className="card-header">
                <div className="card-title">SKIP REASONS</div>
                <div style={{ fontSize: 10, color: "#444", letterSpacing: 1 }}>244 EVALUATIONS</div>
              </div>
              {SKIP_REASONS.map((s, i) => (
                <div className="skip-row" key={i}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "#888", letterSpacing: 1, marginBottom: 6 }}>
                      {s.reason.replace(/_/g, " ").toUpperCase()}
                    </div>
                    <div className="skip-bar-bg">
                      <div className="skip-bar-fill" style={{ width: `${s.pct}%` }} />
                    </div>
                  </div>
                  <div className="skip-count">{s.count}</div>
                </div>
              ))}
            </div>
          </div>

          {/* MONEY FLOW + METRICS */}
          <div className="two-col fade-in fade-in-4">
            <div className="metric-card" style={{ gridColumn: "span 1" }}>
              <div className="card-title" style={{ marginBottom: 24 }}>MONEY FLOW · LIVE</div>
              <MoneyFlowBars />
            </div>

            <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 24 }}>
              <div className="metric-card">
                <div className="metric-big green">4</div>
                <div className="metric-label">CONSECUTIVE WINS</div>
                <div className="streak-dots">
                  {["w","w","l","w","w","w","w","l","w","w"].map((r, i) => (
                    <div key={i} className={`streak-dot ${r}`} />
                  ))}
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-big">$2,100</div>
                <div className="metric-label">AVG POSITION SIZE</div>
                <div className="metric-sub" style={{ marginTop: 12 }}>
                  <span style={{ color: "#00e87a" }}>3–5%</span> · MONTHS 2–6 SIZING
                </div>
                <div style={{ marginTop: 16, height: 2, background: "#1f1f1f" }}>
                  <div style={{ height: "100%", width: "42%", background: "#00e87a" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#444", marginTop: 6, letterSpacing: 1 }}>
                  <span>$0</span>
                  <span>CURRENT</span>
                  <span>$5,000</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
