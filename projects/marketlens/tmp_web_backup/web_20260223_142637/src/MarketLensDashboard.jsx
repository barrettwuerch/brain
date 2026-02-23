// Prototype dashboard component (from ~/Downloads/MarketLensDashboard.jsx)
// Note: uses mock data; wire to Supabase insights later.

import { useState } from "react";

// ── Mock Data ──────────────────────────────────────────────────────────────
const MOCK_INSIGHTS = [
  {
    id: "1",
    headline: "SCOTUS Kills Tariffs — $175B Refund Pipeline Opens",
    question: "Will import-heavy retailers outperform over the next 4 weeks?",
    thesis:
      "The 6-3 ruling wipes out reciprocal tariffs on all major trading partners. Import-heavy retailers and automakers get immediate cost relief. The sleeper play: who files first for the $175B refund pile.",
    sectors: ["Consumer Retail", "Auto", "Tech Hardware", "Logistics"],
    tickers: ["AMZN", "TGT", "TM", "AAPL", "UPS"],
    direction: "bullish",
    conviction: 88,
    time_horizon: "short",
    second_order: [
      "Companies that pre-restructured supply chains now have a cost DISadvantage vs. competitors who held out — watch for margin compression in reshored manufacturers.",
      "Refund litigation takes 2–4 years. Firms with airtight import records and legal bandwidth will capture the lion's share.",
      "Trump's Section 122 replacement (15%) has a 150-day statutory cap — a known sunset date the market hasn't priced yet.",
    ],
    risks: [
      "Trump escalates via Section 232",
      "CIT refund mechanism still unresolved",
      "15% replacement tariff partially offsets relief",
    ],
    educational_context:
      "IEEPA is a 1977 emergency powers law. No president before Trump used it to impose tariffs. The Supreme Court said two words — 'regulate' and 'importation' — couldn't carry that weight.",
    created_at: "2026-02-20T14:00:00Z",
    story_count: 12,
    views: 847,
  },
  {
    id: "2",
    headline: "Fed Softens Language — Late-2026 Cut Window Opens",
    question: "Will the Fed cut at least once before December 2026?",
    thesis:
      "FOMC removed 'further restrictive' from their statement. The hiking cycle is officially over. Duration-sensitive assets haven't fully reacted yet — the window is open.",
    sectors: ["Financials", "REITs", "Utilities", "Long Duration Tech"],
    tickers: ["TLT", "VNQ", "O", "NEE"],
    direction: "bullish",
    conviction: 67,
    time_horizon: "medium",
    second_order: [
      "Regional banks with floating-rate loan books benefit less than expected — most already repriced.",
      "Utility stocks, which underperformed during rate hikes, now face a structural tailwind.",
    ],
    risks: [
      "Inflation re-acceleration delays cuts",
      "Election year complicates Fed independence narrative",
    ],
    educational_context:
      "Duration measures how sensitive a bond is to rate changes. When rates fall, longer-duration bonds rise more — that's why TLT is the classic rate-cut play.",
    created_at: "2026-02-19T18:00:00Z",
    story_count: 7,
    views: 512,
  },
  {
    id: "3",
    headline: "Chip Export Controls Tighten — H20 Loophole Closed",
    question: "Will Nvidia's China revenue fall more than 20% this quarter?",
    thesis:
      "New BIS rules kill the H20 chip workaround Nvidia was using to sell into China. Near-term revenue hit incoming — but this accidentally accelerates China's domestic AI chip industry.",
    sectors: ["Semiconductors", "AI Infrastructure", "China Tech"],
    tickers: ["NVDA", "AMD", "SMIC", "CXMT"],
    direction: "mixed",
    conviction: 71,
    time_horizon: "immediate",
    second_order: [
      "ASML and TSMC face reduced long-term demand from China fabs that can't get leading-edge tools.",
      "Domestic Chinese AI chip firms receive forced market protection — competitive timelines could accelerate 2–3 years.",
    ],
    risks: [
      "China retaliates via rare earth controls",
      "Nvidia legal challenge could pause enforcement",
    ],
    educational_context:
      "BIS (Bureau of Industry and Security) controls semiconductor exports. The H20 was Nvidia's intentionally downgraded chip designed to slip under export thresholds. New rules close that gap.",
    created_at: "2026-02-18T10:00:00Z",
    story_count: 9,
    views: 634,
  },
  {
    id: "4",
    headline: "EU Pauses Trade Deal Ratification — Leverage Shift",
    question: "Will the EU-US trade deal be signed before Q4 2026?",
    thesis:
      "EU lawmakers hit pause after the SCOTUS ruling gave them unexpected negotiating leverage. Agricultural and EV concessions are now live bargaining chips.",
    sectors: ["European Equities", "Agriculture", "EV / Auto"],
    tickers: ["VGK", "DE", "F", "STLA"],
    direction: "neutral",
    conviction: 42,
    time_horizon: "medium",
    second_order: [
      "EU leverage increase could benefit European automakers in US market access talks.",
      "US agricultural exporters (soybeans, corn) may see EU access concessions as a sweetener.",
    ],
    risks: [
      "Negotiations could collapse entirely",
      "US pivots to bilateral deals that cut out EU",
    ],
    educational_context:
      "EU trade deal ratification requires approval from the European Parliament AND Council — every member state has veto power, making it a slow, high-drama process.",
    created_at: "2026-02-21T09:00:00Z",
    story_count: 5,
    views: 289,
  },
];

const PIPELINE_ITEMS = [
  {
    event: "CIT Rules on $175B Tariff Refunds",
    probability: 85,
    timeline: "Q2 2026",
    direction: "bullish",
    hot: true,
  },
  {
    event: "Fed March Rate Decision",
    probability: 72,
    timeline: "Mar 18–19",
    direction: "bullish",
    hot: false,
  },
  {
    event: "Nvidia Challenges Export Controls",
    probability: 60,
    timeline: "Q3 2026",
    direction: "mixed",
    hot: false,
  },
  {
    event: "Section 122 Tariff Sunset (150-day cap)",
    probability: 91,
    timeline: "Jul 2026",
    direction: "bullish",
    hot: true,
  },
];

const SECTOR_DATA = [
  { sector: "Consumer Retail", score: 82, direction: "bullish", change: "+12" },
  { sector: "Auto", score: 74, direction: "bullish", change: "+9" },
  { sector: "Utilities", score: 71, direction: "bullish", change: "+6" },
  { sector: "REITs", score: 68, direction: "bullish", change: "+4" },
  { sector: "Logistics", score: 60, direction: "mixed", change: "+2" },
  { sector: "Financials", score: 55, direction: "neutral", change: "0" },
  { sector: "AI Infra", score: 44, direction: "mixed", change: "-3" },
  { sector: "Semiconductors", score: 35, direction: "bearish", change: "-11" },
  { sector: "China Tech", score: 28, direction: "bearish", change: "-8" },
];

const DIR = {
  bullish: {
    label: "YES",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
    bar: "bg-emerald-500",
    pill: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
  bearish: {
    label: "NO",
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-600",
    bar: "bg-red-500",
    pill: "bg-red-100 text-red-700 border-red-200",
  },
  mixed: {
    label: "SPLIT",
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    bar: "bg-amber-400",
    pill: "bg-amber-100 text-amber-700 border-amber-200",
  },
  neutral: {
    label: "WATCH",
    bg: "bg-slate-50",
    border: "border-slate-200",
    text: "text-slate-500",
    bar: "bg-slate-400",
    pill: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

const HORIZON = {
  immediate: {
    label: "⚡ Right Now",
    color: "bg-red-100 text-red-700 border-red-200",
  },
  short: {
    label: "📅 1–4 Weeks",
    color: "bg-amber-100 text-amber-700 border-amber-200",
  },
  medium: {
    label: "📆 1–6 Months",
    color: "bg-blue-100 text-blue-700 border-blue-200",
  },
  long: {
    label: "📈 Long Game",
    color: "bg-purple-100 text-purple-700 border-purple-200",
  },
};

const TICKERS_TAPE = [
  "AMZN +2.3%",
  "TGT +1.8%",
  "TM +3.1%",
  "AAPL -0.4%",
  "TLT +1.2%",
  "NVDA -2.8%",
  "VNQ +0.9%",
  "NEE +1.5%",
  "UPS +2.1%",
  "DE +0.6%",
  "F +1.3%",
];

function timeAgo(iso) {
  const h = (Date.now() - new Date(iso)) / 3600000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ── Probability Bar ────────────────────────────────────────────────────────
function ProbBar({ conviction, direction }) {
  const d = DIR[direction];
  return (
    <div className="space-y-2">
      <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full ${d.bar} rounded-full transition-all duration-700`}
          style={{ width: `${conviction}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="text-xs font-black text-white drop-shadow mix-blend-multiply"
            style={{
              mixBlendMode: "normal",
              textShadow: "0 1px 2px rgba(0,0,0,0.3)",
            }}
          >
            {conviction}%
          </span>
        </div>
      </div>
      <div className="flex justify-between text-xs font-bold">
        <span className={d.text}>
          {d.label} · {conviction}%
        </span>
        <span className="text-slate-400">NO · {100 - conviction}%</span>
      </div>
    </div>
  );
}

// ── Insight Card ───────────────────────────────────────────────────────────
function InsightCard({ insight, featured }) {
  const [expanded, setExpanded] = useState(false);
  const [showEdu, setShowEdu] = useState(false);
  const d = DIR[insight.direction];
  const h = HORIZON[insight.time_horizon];

  return (
    <div
      className={`rounded-2xl border-2 bg-white overflow-hidden transition-all duration-200 ${
        featured
          ? `${d.border} shadow-lg`
          : "border-slate-100 shadow-sm hover:shadow-md hover:border-slate-200"
      }`}
    >
      <div className="p-5 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {featured && (
              <span className="text-xs font-black px-2.5 py-1 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                🔥 HOT TAKE
              </span>
            )}
            <span className={`text-xs font-black px-2.5 py-1 rounded-full border ${h.color}`}>{h.label}</span>
            <span className={`text-xs font-black px-2.5 py-1 rounded-full border ${d.pill}`}>{d.label}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0">
            <span>👁 {insight.views.toLocaleString()}</span>
            <span>{timeAgo(insight.created_at)}</span>
            <span className={`text-slate-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>▾</span>
          </div>
        </div>

        <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">The Question</div>
        <h3 className={`font-black text-slate-900 leading-snug mb-4 ${featured ? "text-base" : "text-sm"}`}>
          {insight.question}
        </h3>

        <ProbBar conviction={insight.conviction} direction={insight.direction} />

        <p className="text-sm text-slate-500 leading-relaxed mt-3">{insight.thesis}</p>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {insight.tickers.map((t) => (
            <span
              key={t}
              className="text-xs font-black font-mono bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-lg"
            >
              {t}
            </span>
          ))}
          {insight.sectors.length > 0 && (
            <span className="text-xs text-slate-400 self-center">
              · {insight.sectors[0]}
              {insight.sectors.length > 1 ? ` +${insight.sectors.length - 1}` : ""}
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div className={`border-t-2 ${d.border} ${d.bg} px-5 py-4 space-y-4`} onClick={(e) => e.stopPropagation()}>
          <div>
            <div className="text-xs font-black tracking-widest text-slate-500 mb-2.5">🔍 SECOND-ORDER EFFECTS</div>
            <div className="space-y-2">
              {insight.second_order.map((s, i) => (
                <div key={i} className="flex gap-3 bg-white rounded-xl p-3.5 border border-white shadow-sm">
                  <span className="text-emerald-500 font-black shrink-0 mt-0.5">→</span>
                  <p className="text-sm text-slate-700 leading-relaxed">{s}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-black tracking-widest text-slate-500 mb-2">⚠️ RISKS</div>
            <div className="space-y-1.5">
              {insight.risks.map((r, i) => (
                <div key={i} className="flex gap-2.5 text-sm text-slate-600 bg-white/70 rounded-lg px-3 py-2">
                  <span className="text-red-400 shrink-0 font-black">•</span> {r}
                </div>
              ))}
            </div>
          </div>

          <div>
            <button
              onClick={() => setShowEdu(!showEdu)}
              className="text-xs font-black tracking-widest text-slate-500 hover:text-violet-600 transition-colors flex items-center gap-1.5"
            >
              <span className="text-base">{showEdu ? "📖" : "📚"}</span>
              WHY DOES THIS MATTER? {showEdu ? "▾" : "▸"}
            </button>
            {showEdu && (
              <div className="mt-2 bg-white rounded-xl p-4 border-2 border-violet-100 text-sm text-slate-600 leading-relaxed">
                {insight.educational_context}
              </div>
            )}
          </div>

          <div className="text-xs text-slate-400 font-mono">
            Synthesized from {insight.story_count} sources · {new Date(insight.created_at).toLocaleDateString()}
          </div>
        </div>
      )}
    </div>
  );
}

function SectorPulse() {
  return (
    <div className="rounded-2xl border-2 border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-black tracking-widest text-slate-500">📊 SECTOR PULSE</span>
        <span className="text-xs text-slate-400">7-day change</span>
      </div>
      <div className="space-y-3">
        {SECTOR_DATA.map((item) => {
          const d = DIR[item.direction];
          const n = parseInt(item.change);
          return (
            <div key={item.sector} className="flex items-center gap-3">
              <div className="text-xs font-medium text-slate-600 w-28 shrink-0 truncate">{item.sector}</div>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${d.bar}`} style={{ width: `${item.score}%` }} />
              </div>
              <span
                className={`text-xs font-black font-mono w-9 text-right ${
                  n > 0 ? "text-emerald-600" : n < 0 ? "text-red-500" : "text-slate-400"
                }`}
              >
                {n > 0 ? "+" : ""}
                {item.change}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ComingUp() {
  return (
    <div className="rounded-2xl border-2 border-slate-100 bg-white p-5 shadow-sm">
      <div className="text-xs font-black tracking-widest text-slate-500 mb-4">🔭 COMING UP</div>
      <div className="space-y-2.5">
        {PIPELINE_ITEMS.map((item, i) => {
          const d = DIR[item.direction];
          return (
            <div
              key={i}
              className={`rounded-xl border-2 p-3.5 transition-all ${item.hot ? `${d.bg} ${d.border}` : "border-slate-100 bg-slate-50"}`}
            >
              <div className="flex items-start gap-1.5 mb-2">
                {item.hot && <span className="text-sm shrink-0">🔥</span>}
                <span className="text-xs font-bold text-slate-800 leading-snug">{item.event}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <div className="flex-1 h-1.5 bg-white rounded-full overflow-hidden border border-slate-200">
                    <div className={`h-full rounded-full ${d.bar}`} style={{ width: `${item.probability}%` }} />
                  </div>
                  <span className={`text-xs font-black ${d.text} shrink-0`}>{item.probability}%</span>
                </div>
                <span className="text-xs font-mono text-slate-400 shrink-0">{item.timeline}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────
export default function MarketLens() {
  const [tab, setTab] = useState("all");

  const featured = MOCK_INSIGHTS.filter((i) => i.conviction >= 80);
  const feed =
    tab === "bullish"
      ? MOCK_INSIGHTS.filter((i) => i.direction === "bullish")
      : tab === "bearish"
        ? MOCK_INSIGHTS.filter((i) => i.direction === "bearish")
        : MOCK_INSIGHTS;

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <header className="sticky top-0 z-50 bg-white border-b-2 border-slate-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-md shadow-violet-200 text-white font-black text-base">
              M
            </div>
            <div>
              <div className="font-black text-slate-900 text-lg leading-none">Market Lens</div>
              <div className="text-xs text-slate-400 font-semibold">Family Edition 🏠</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 bg-emerald-50 border-2 border-emerald-200 rounded-full px-3.5 py-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse block" />
              <span className="text-xs font-black text-emerald-700">BULLISH WEEK</span>
            </div>
            <div className="text-xs text-slate-400 hidden md:block font-mono">Updated 23m ago</div>
          </div>
        </div>

        <div className="border-t border-slate-100 bg-gradient-to-r from-slate-50 to-white overflow-hidden">
          <div className="flex items-center gap-8 px-5 py-1.5 text-xs font-black font-mono overflow-x-auto whitespace-nowrap">
            {TICKERS_TAPE.map((t) => {
              const up = t.includes("+");
              return (
                <span key={t} className={up ? "text-emerald-600" : "text-red-500"}>
                  {up ? "▲" : "▼"} {t}
                </span>
              );
            })}
          </div>
        </div>
      </header>

      <div className="bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600">
        <div className="max-w-6xl mx-auto px-5 py-3.5 flex items-start gap-3">
          <span className="text-xl shrink-0 mt-0.5">🧠</span>
          <p className="text-sm font-semibold text-white/90">
            <strong className="font-black text-white">This week's read:</strong> The SCOTUS tariff ruling is net-bullish for
            importers, but the real alpha is in refund litigation timing. Chip stocks face a simultaneous export headwind.
            Keep an eye on the CIT ruling date.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-5 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <div className="grid grid-cols-4 gap-3">
              {[
                { e: "📡", n: "47", l: "Stories", s: "ingested" },
                { e: "💡", n: "4", l: "Insights", s: "this week" },
                { e: "📈", n: "2", l: "Bullish", s: "signals" },
                { e: "📉", n: "1", l: "Bearish", s: "signals" },
              ].map((s) => (
                <div
                  key={s.l}
                  className="bg-white rounded-2xl border-2 border-slate-100 p-3.5 text-center shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="text-xl mb-0.5">{s.e}</div>
                  <div className="text-2xl font-black text-slate-900 leading-none">{s.n}</div>
                  <div className="text-xs font-bold text-slate-500 mt-1">{s.l}</div>
                  <div className="text-xs text-slate-400">{s.s}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-black text-slate-800">🔥 High Conviction</span>
                <div className="flex-1 h-0.5 bg-slate-200 rounded" />
                <span className="text-xs text-slate-400 font-mono">{featured.length} picks</span>
              </div>
              <div className="space-y-3">{featured.map((i) => <InsightCard key={i.id} insight={i} featured={true} />)}</div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <div className="flex items-center gap-1 bg-white rounded-xl border-2 border-slate-100 p-1 shadow-sm">
                  {[
                    { k: "all", l: "All", e: "📋" },
                    { k: "bullish", l: "Bullish", e: "📈" },
                    { k: "bearish", l: "Bearish", e: "📉" },
                  ].map((t) => (
                    <button
                      key={t.k}
                      onClick={() => setTab(t.k)}
                      className={`text-xs font-black px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                        tab === t.k ? "bg-violet-600 text-white shadow-md shadow-violet-200" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {t.e} {t.l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">{feed.map((i) => <InsightCard key={i.id} insight={i} featured={false} />)}</div>
            </div>
          </div>

          <div className="space-y-4">
            <SectorPulse />
            <ComingUp />

            <div className="rounded-2xl border-2 border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 p-5 shadow-sm">
              <div className="font-black text-slate-900 text-base mb-1">📬 Weekly Digest</div>
              <p className="text-sm text-slate-500 mb-3 leading-relaxed">Top 3 insights every Sunday. No noise, no spam.</p>
              <div className="space-y-2">
                <input
                  type="email"
                  placeholder="your@email.com"
                  className="w-full text-sm bg-white border-2 border-violet-200 rounded-xl px-3.5 py-2.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-violet-500 transition-colors"
                />
                <button className="w-full text-sm font-black text-white bg-violet-600 hover:bg-violet-700 active:scale-95 px-4 py-2.5 rounded-xl transition-all shadow-md shadow-violet-200">
                  Subscribe →
                </button>
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 border-2 border-amber-200 p-4">
              <div className="text-xs font-black text-amber-700 mb-1">⚠️ Heads up</div>
              <p className="text-xs text-amber-600 leading-relaxed">
                AI-generated analysis for family use. Not financial advice. Do your own research before making any moves.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
