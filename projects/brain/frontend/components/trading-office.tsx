"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ─── CANVAS CONSTANTS ─────────────────────────────────────────────
const CW = 900, CH = 620;
const TW = 64, TH = 32;
const OX = CW * 0.46, OY = 80;
function sc(c: number, r: number) {
  return { x: OX + ((c - r) * TW) / 2, y: OY + ((c + r) * TH) / 2 };
}

// ─── COLORS ───────────────────────────────────────────────────────
const P = {
  bg: "#060810", fl0: "#0b1022", fl1: "#0d1228",
  wT: "#142038", wL: "#0a1628", wR: "#0d1c32",
  dT: "#1a3828", dL: "#102218", dR: "#142e20",
};

// ─── BOTS ─────────────────────────────────────────────────────────
const BOTS = [
  { id: "cos",       label: "Chief of Staff",  e: "👑", hex: "#f472b6", c: 4, r: 0,  isCoS: true },
  { id: "research",  label: "Research",        e: "🔬", hex: "#22d3ee", c: 1, r: 2 },
  { id: "strategy",  label: "Strategy",        e: "♟",  hex: "#a78bfa", c: 4, r: 2 },
  { id: "risk",      label: "Risk",            e: "⚠",  hex: "#f87171", c: 7, r: 2 },
  { id: "execution", label: "Execution",       e: "⚡", hex: "#fbbf24", c: 1, r: 6 },
  { id: "intel",     label: "Intelligence",    e: "🦉", hex: "#34d399", c: 4, r: 6 },
  { id: "orch",      label: "Orchestrator",    e: "🎯", hex: "#e879f9", c: 7, r: 6 },
  { id: "scanner",   label: "Scanner",         e: "📡", hex: "#fb923c", c: 4, r: 9 },
];

const EV: Record<string, string[]> = {
  cos:       ["👑 Daily brief: ALL CLEAR", "📋 Priorities set", "🔍 Blind spot detected!", "⚠ Regime gap — directive issued"],
  research:  ["🔍 Scanning Kalshi...", "📊 Vol anomaly: BTC!", "✨ RQS 0.71 — routing!", "🔬 Validating mechanism"],
  strategy:  ["♟ Formalizing edge...", "⚔ Challenge: testing...", "✅ Strategy approved!", "❌ Failed challenge"],
  risk:      ["📡 Regime: LOW vol", "💰 Kelly: 2.3% capital", "⚠ ENP low!", "✅ Portfolio nominal"],
  execution: ["⚡ Placing order...", "✅ Filled @ 0.73", "📍 Managing position", "💰 Closed: +2.1% ✓"],
  intel:     ["🦉 Consolidating...", "📝 Daily report ready", "💡 SKILL update proposed!", "📈 Velocity improving"],
  orch:      ["🎯 Routing finding...", "🗺 Priority map updated", "⚡ All bots healthy", "🔄 Watch condition set"],
  scanner:   ["📡 Scanning...", "⚡ Condition fired!", "😴 Monitoring quietly...", "✅ 5-gate check: pass"],
};

const REGIMES: Record<string, { label: string; color: string; bg: string }> = {
  low:      { label: "LOW VOL",      color: "#4ade80", bg: "rgba(74,222,128,0.1)" },
  normal:   { label: "NORMAL",       color: "#00e5ff", bg: "rgba(0,229,255,0.08)" },
  elevated: { label: "ELEVATED VOL", color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
  extreme:  { label: "EXTREME VOL",  color: "#f87171", bg: "rgba(248,113,113,0.1)" },
};

const SS: Record<string, { fg: string; label: string }> = {
  exploiting: { fg: "#00d68f", label: "EXPLOITING" },
  cautious:   { fg: "#fbbf24", label: "CAUTIOUS" },
  paused:     { fg: "#f87171", label: "PAUSED" },
  recovering: { fg: "#93c5fd", label: "RECOVERING" },
  diagnostic: { fg: "#d8b4fe", label: "DIAGNOSTIC" },
};

// ─── DRAW HELPERS ─────────────────────────────────────────────────
function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lx(hex: string, n = 40) {
  const [r, g, b] = hexRgb(hex);
  return `rgb(${Math.min(255,r+n)},${Math.min(255,g+n)},${Math.min(255,b+n)})`;
}
function dk(hex: string, n = 40) {
  const [r, g, b] = hexRgb(hex);
  return `rgb(${Math.max(0,r-n)},${Math.max(0,g-n)},${Math.max(0,b-n)})`;
}

function drawTile(ctx: CanvasRenderingContext2D, c: number, r: number) {
  const { x, y } = sc(c, r);
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + TW/2, y + TH/2);
  ctx.lineTo(x, y + TH); ctx.lineTo(x - TW/2, y + TH/2);
  ctx.closePath();
  ctx.fillStyle = (c + r) % 2 === 0 ? P.fl0 : P.fl1;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.025)";
  ctx.lineWidth = 0.5; ctx.stroke();
  if ((c + r) % 4 === 0) {
    ctx.fillStyle = "rgba(0,229,255,0.05)";
    ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI*2); ctx.fill();
  }
}

function drawCube(ctx: CanvasRenderingContext2D, c: number, r: number, h: number, top: string, left: string, right: string) {
  const { x, y } = sc(c, r); const ty = y - h;
  ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(x,ty); ctx.lineTo(x+TW/2,ty+TH/2); ctx.lineTo(x,ty+TH); ctx.lineTo(x-TW/2,ty+TH/2); ctx.closePath();
  ctx.fillStyle = top; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x-TW/2,ty+TH/2); ctx.lineTo(x,ty+TH); ctx.lineTo(x,y+TH); ctx.lineTo(x-TW/2,y+TH/2); ctx.closePath();
  ctx.fillStyle = left; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x+TW/2,ty+TH/2); ctx.lineTo(x,ty+TH); ctx.lineTo(x,y+TH); ctx.lineTo(x+TW/2,y+TH/2); ctx.closePath();
  ctx.fillStyle = right; ctx.fill(); ctx.stroke();
}

function drawMonitor(ctx: CanvasRenderingContext2D, c: number, r: number, hex: string, t: number, active: boolean) {
  const { x, y } = sc(c, r);
  const mx = x + 5, my = y - 38;
  const [rr, gg, bb] = hexRgb(hex);
  const glow = active ? 0.5 + 0.3 * Math.abs(Math.sin(t * 0.006)) : 0.2;
  ctx.fillStyle = "#080e1c"; ctx.fillRect(mx-14, my-14, 28, 20);
  ctx.strokeStyle = "#1a2a44"; ctx.lineWidth = 1; ctx.strokeRect(mx-14, my-14, 28, 20);
  ctx.fillStyle = `rgba(${rr},${gg},${bb},${glow*0.3})`; ctx.fillRect(mx-12, my-12, 24, 16);
  for (let i = 0; i < 16; i += 2) { ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.fillRect(mx-12, my-12+i, 24, 1); }
  if (active) {
    ctx.fillStyle = `rgba(${rr},${gg},${bb},0.9)`;
    for (let i = 0; i < 3; i++) {
      const w = 8 + Math.floor((Math.sin(t * 0.012 + i * 2) + 1) * 7);
      ctx.fillRect(mx-11, my-10+i*5, w, 2);
    }
    ctx.fillStyle = `rgba(${rr},${gg},${bb},0.6)`;
    ctx.fillRect(mx+9, my-13, 3, 3);
    const sg = ctx.createRadialGradient(mx, my-4, 0, mx, my-4, 20);
    sg.addColorStop(0, `rgba(${rr},${gg},${bb},0.15)`);
    sg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sg; ctx.fillRect(mx-20, my-20, 40, 30);
  }
  ctx.fillStyle = "#0f1828"; ctx.fillRect(mx-4, my+6, 8, 6); ctx.fillRect(mx-7, my+12, 14, 3);
}

function drawVoxelBot(ctx: CanvasRenderingContext2D, bx: number, by: number, hex: string, state: string, t: number, active: boolean, selected: boolean, isCoS: boolean) {
  const bob = Math.sin(t * (active ? 0.09 : 0.038)) * (active ? 3.5 : 1.8);
  const y = by + bob;
  const s = isCoS ? 1.25 : 1.0;
  const top = lx(hex, 50), mid = hex, drk = dk(hex, 40);

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath(); ctx.ellipse(bx, by+12*s, 14*s, 5*s, 0, 0, Math.PI*2); ctx.fill();

  function voxel(vx: number, vy: number, w: number, depth: number) {
    const tw2 = w*0.5, th2 = w*0.25;
    ctx.beginPath();
    ctx.moveTo(vx, vy); ctx.lineTo(vx+tw2, vy+th2); ctx.lineTo(vx, vy+tw2*0.5+th2*0.5); ctx.lineTo(vx-tw2, vy+th2); ctx.closePath();
    ctx.fillStyle = top; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 0.4; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(vx-tw2, vy+th2); ctx.lineTo(vx, vy+tw2*0.5+th2*0.5); ctx.lineTo(vx, vy+tw2*0.5+th2*0.5+depth); ctx.lineTo(vx-tw2, vy+th2+depth); ctx.closePath();
    ctx.fillStyle = mid; ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(vx+tw2, vy+th2); ctx.lineTo(vx, vy+tw2*0.5+th2*0.5); ctx.lineTo(vx, vy+tw2*0.5+th2*0.5+depth); ctx.lineTo(vx+tw2, vy+th2+depth); ctx.closePath();
    ctx.fillStyle = drk; ctx.fill(); ctx.stroke();
  }

  const legAnim = active ? Math.sin(t*0.12)*5 : 0;
  voxel(bx-6*s, y+8*s+legAnim, 10*s, 8*s);
  voxel(bx+6*s, y+8*s-legAnim, 10*s, 8*s);
  voxel(bx, y, 20*s, 14*s);
  const armAnim = active ? Math.sin(t*0.1)*6 : 0;
  voxel(bx-16*s, y-2*s+armAnim, 8*s, 8*s);
  voxel(bx+16*s, y-2*s-armAnim, 8*s, 8*s);
  voxel(bx, y-18*s, 16*s, 12*s);

  // Eyes
  ctx.fillStyle = selected ? "rgba(255,255,255,0.9)" : "rgba(6,8,16,0.85)";
  ctx.fillRect(bx-7*s, y-24*s, 4*s, 3*s); ctx.fillRect(bx+3*s, y-24*s, 4*s, 3*s);

  // Mouth
  ctx.fillStyle = drk;
  if (state === "paused") {
    ctx.fillRect(bx-4*s, y-18*s, 8*s, 2*s);
  } else {
    ctx.fillRect(bx-4*s, y-19*s, 3*s, 2*s); ctx.fillRect(bx+1*s, y-19*s, 3*s, 2*s);
    ctx.fillRect(bx-2*s, y-17.5*s, 4*s, 1.5*s);
  }

  // CoS crown
  if (isCoS) {
    const cg = 0.7 + 0.3*Math.abs(Math.sin(t*0.004));
    ctx.fillStyle = `rgba(255,200,0,${cg})`;
    ctx.shadowColor = "rgba(255,180,0,0.9)"; ctx.shadowBlur = 12;
    ctx.fillRect(bx-10*s, y-34*s, 20*s, 5*s);
    ctx.beginPath();
    ctx.moveTo(bx-10*s,y-34*s); ctx.lineTo(bx-10*s,y-43*s); ctx.lineTo(bx-5*s,y-38*s);
    ctx.lineTo(bx,y-46*s); ctx.lineTo(bx+5*s,y-38*s); ctx.lineTo(bx+10*s,y-43*s); ctx.lineTo(bx+10*s,y-34*s);
    ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
  }

  // State dot
  const stColor = SS[state]?.fg ?? "#00d68f";
  ctx.fillStyle = stColor; ctx.shadowColor = stColor; ctx.shadowBlur = active ? 10 : 4;
  ctx.beginPath(); ctx.arc(bx+12*s, y-(isCoS?30:22)*s, 4*s, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;

  if (selected) {
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.5;
    ctx.setLineDash([3,3]);
    ctx.strokeRect(bx-22*s, y-(isCoS?50:35)*s, 44*s, 65*s);
    ctx.setLineDash([]);
  }
}

function drawScene(ctx: CanvasRenderingContext2D, t: number, statesR: Record<string,string>, activeR: Record<string,boolean>, selR: string | null) {
  // BG gradient
  const bgG = ctx.createRadialGradient(CW/2, CH*0.4, 50, CW/2, CH*0.4, CW*0.7);
  bgG.addColorStop(0, "#0b1128"); bgG.addColorStop(1, "#060810");
  ctx.fillStyle = bgG; ctx.fillRect(0, 0, CW, CH);

  // Tiles
  for (let r = 0; r < 11; r++) for (let c = 0; c < 10; c++) drawTile(ctx, c, r);

  // Ambient glow pools
  const pools: [number,number,string][] = [[2,2,"#22d3ee"],[7,2,"#a78bfa"],[4,5,"#f472b6"],[2,7,"#fbbf24"],[7,7,"#34d399"]];
  for (const [pc, pr, col] of pools) {
    const { x, y } = sc(pc, pr);
    const pg = ctx.createRadialGradient(x, y+TH, 0, x, y+TH, 60);
    pg.addColorStop(0, col+"18"); pg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(x, y+TH, 60, 24, 0, 0, Math.PI*2); ctx.fill();
  }

  // Back wall
  for (let c = 0; c < 10; c++) drawCube(ctx, c, -1, 32, P.wT, P.wL, P.wR);

  // Wall screen
  const ws = sc(5, -1);
  ctx.fillStyle = "#080e1c"; ctx.fillRect(ws.x-55, ws.y-54, 110, 42);
  ctx.strokeStyle = "#1a3060"; ctx.lineWidth = 1; ctx.strokeRect(ws.x-55, ws.y-54, 110, 42);
  ctx.fillStyle = "rgba(34,100,220,0.12)"; ctx.fillRect(ws.x-53, ws.y-52, 106, 38);
  for (let i = 0; i < 38; i += 2) { ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.fillRect(ws.x-53, ws.y-52+i, 106, 1); }
  ctx.textAlign = "center";
  ctx.font = 'bold 7.5px "DM Mono", monospace'; ctx.fillStyle = "#4488ff";
  ctx.fillText("THE BRAIN — LIVE", ws.x, ws.y-38);
  ctx.fillStyle = "#00d68f"; ctx.fillText("ALL SYSTEMS OPERATIONAL", ws.x, ws.y-27);
  ctx.fillStyle = "#f472b6"; ctx.font = '7px "DM Mono", monospace';
  ctx.fillText("CoS: ALL CLEAR · SIMULATION RUNNING", ws.x, ws.y-16);
  const tickerText = "BTC +0.42%   ETH +0.31%   SOL +0.98%   ";
  const tickerOff = (t * 0.035) % (tickerText.length * 4.8);
  ctx.fillStyle = "#fbbf24";
  ctx.fillText(tickerText + tickerText, ws.x - tickerOff + 110, ws.y-6);

  // Corner pillars
  drawCube(ctx, 0, 0, 26, P.dT, P.dL, P.dR);
  drawCube(ctx, 9, 0, 26, P.dT, P.dL, P.dR);

  // Light rays
  const rayA = 0.04 + 0.01*Math.sin(t*0.002);
  for (let i = 0; i < 5; i++) {
    const rx = CW*0.15 + i*(CW*0.17);
    const grad = ctx.createLinearGradient(rx, 0, rx+60, CH*0.6);
    grad.addColorStop(0, `rgba(100,150,255,${rayA})`); grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(rx,0); ctx.lineTo(rx+80,0); ctx.lineTo(rx+120,CH*0.6); ctx.lineTo(rx+20,CH*0.6); ctx.closePath(); ctx.fill();
  }

  // Bots sorted by depth
  const sorted = [...BOTS].sort((a,b) => (a.r+a.c)-(b.r+b.c));
  for (const bot of sorted) {
    const state = statesR[bot.id] || "exploiting";
    const isAct = activeR[bot.id] || false;
    const isSel = selR === bot.id;
    const { x, y } = sc(bot.c, bot.r);
    if (isAct) {
      const [rr,gg,bb] = hexRgb(bot.hex);
      const g = ctx.createRadialGradient(x, y+TH, 0, x, y+TH, 55);
      g.addColorStop(0, `rgba(${rr},${gg},${bb},0.22)`); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y+TH, 55, 22, 0, 0, Math.PI*2); ctx.fill();
    }
    drawCube(ctx, bot.c, bot.r, 18, P.dT, P.dL, P.dR);
    drawMonitor(ctx, bot.c, bot.r, bot.hex, t, isAct);
    const bp = sc(bot.c, bot.r + 0.55);
    drawVoxelBot(ctx, bp.x, bp.y-8, bot.hex, state, t, isAct, isSel, !!bot.isCoS);
  }

  // Vignette
  const vg = ctx.createRadialGradient(CW/2, CH/2, CH*0.28, CW/2, CH/2, CH*0.85);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, CW, CH);
}

// ─── COMPONENT ────────────────────────────────────────────────────
export default function TradingOffice() {
  const cvs = useRef<HTMLCanvasElement>(null);
  const raf = useRef<number>(0);
  const statesRef = useRef<Record<string,string>>({});
  const activeRef = useRef<Record<string,boolean>>({});
  const selRef = useRef<string|null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [states, setStates] = useState(() => Object.fromEntries(BOTS.map(b => [b.id, "exploiting"])));
  const [active, setActive] = useState(() => Object.fromEntries(BOTS.map(b => [b.id, false])));
  const [selected, setSelected] = useState<string|null>(null);
  const [bubbles, setBubbles] = useState<{id:number;botId:string;msg:string;born:number}[]>([]);
  const [log, setLog] = useState<{time:string;label:string;hex:string;e:string;msg:string}[]>([]);
  const [regime, setRegime] = useState("normal");
  const [time, setTime] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<"floor"|"bots"|"activity">("floor");

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check(); window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => { statesRef.current = states; }, [states]);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { selRef.current = selected; }, [selected]);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"})), 1000);
    return () => clearInterval(t);
  }, []);

  // Canvas resize + render loop
  useEffect(() => {
    const canvas = cvs.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d")!;
    let dpr = window.devicePixelRatio || 1;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      const W = wrap!.offsetWidth, H = wrap!.offsetHeight;
      canvas!.width = W * dpr; canvas!.height = H * dpr;
      canvas!.style.width = W + "px"; canvas!.style.height = H + "px";
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    function frame(ts: number) {
      const W = wrap!.offsetWidth, H = wrap!.offsetHeight;
      ctx.save();
      ctx.clearRect(0, 0, W*dpr, H*dpr);
      const scale = Math.min(W/CW, H/CH) * 0.92 * dpr;
      const offX = (W*dpr - CW*scale)/2;
      const offY = (H*dpr - CH*scale)/2;
      ctx.translate(offX, offY); ctx.scale(scale, scale);
      drawScene(ctx, ts, statesRef.current, activeRef.current, selRef.current);
      ctx.restore();
      raf.current = requestAnimationFrame(frame);
    }
    raf.current = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf.current); ro.disconnect(); };
  }, []);

  // Events
  useEffect(() => {
    const iv = setInterval(() => {
      const bot = BOTS[Math.floor(Math.random() * BOTS.length)];
      const msgs = EV[bot.id];
      const msg = msgs[Math.floor(Math.random() * msgs.length)];
      const id = Date.now() + Math.random();
      setActive(a => ({ ...a, [bot.id]: true }));
      setTimeout(() => setActive(a => ({ ...a, [bot.id]: false })), 2800);
      setBubbles(b => [...b.slice(-5), { id, botId: bot.id, msg, born: Date.now() }]);
      setTimeout(() => setBubbles(b => b.filter(x => x.id !== id)), 3500);
      setLog(l => [{ time: new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}), label: bot.label, hex: bot.hex, e: bot.e, msg }, ...l.slice(0, 19)]);
      if (Math.random() < 0.07) {
        const keys = Object.keys(SS);
        setStates(s => ({ ...s, [bot.id]: keys[Math.floor(Math.random()*keys.length)] }));
      }
      if (Math.random() < 0.04) {
        setRegime(Object.keys(REGIMES)[Math.floor(Math.random()*4)]);
      }
    }, 2200);
    return () => clearInterval(iv);
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = cvs.current; const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = canvas.getBoundingClientRect();
    const W = wrap.offsetWidth, H = wrap.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    const scl = Math.min(W/CW, H/CH) * 0.92 * dpr;
    const offX = (W*dpr - CW*scl)/2;
    const offY = (H*dpr - CH*scl)/2;
    const mx = ((e.clientX - rect.left) * dpr - offX) / scl;
    const my = ((e.clientY - rect.top) * dpr - offY) / scl;
    for (const bot of BOTS) {
      const { x, y } = sc(bot.c, bot.r + 0.55);
      if (Math.abs(mx - x) < 20 && Math.abs(my - (y-8)) < 32) {
        setSelected(s => s === bot.id ? null : bot.id); return;
      }
    }
    setSelected(null);
  }, []);

  const rc = REGIMES[regime] || REGIMES.normal;
  const selBot = BOTS.find(b => b.id === selected);

  // ── SIDEBAR ───────────────────────────────────────────────────
  const Sidebar = () => (
    <div style={{ width: isMobile ? "100%" : 240, borderLeft: isMobile ? "none" : "1px solid rgba(255,255,255,0.055)", borderTop: isMobile ? "1px solid rgba(255,255,255,0.055)" : "none", background: "#0b0f1a", display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden", height: isMobile ? 260 : "100%" }}>

      {/* Mobile tab bar */}
      {isMobile && (
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.055)" }}>
          {(["bots","activity"] as const).map(tab => (
            <button key={tab} onClick={() => setMobileTab(tab)} style={{ flex:1, padding: "8px 0", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", background: "none", border: "none", cursor: "pointer", color: mobileTab===tab ? "#00e5ff" : "#4a5568", borderBottom: `2px solid ${mobileTab===tab ? "#00e5ff" : "transparent"}`, fontFamily: "'DM Mono', monospace" }}>
              {tab === "bots" ? "🤖 Bots" : "⚡ Activity"}
            </button>
          ))}
        </div>
      )}

      {/* Desktop: Portfolio card */}
      {!isMobile && (
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.055)", padding: "12px 16px 14px" }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: "#3a4460", letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 8 }}>Portfolio</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#f0f2f8", letterSpacing: "-0.5px", lineHeight: 1 }}>$5,000.00</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#00d68f", fontFamily: "'DM Mono', monospace", marginTop: 3 }}>+$3.64 <span style={{ fontSize: 10, color: "#6b7a99" }}>(+0.07%)</span></div>
          <div style={{ marginTop: 10, height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: "12.8%", background: "linear-gradient(90deg, #00e5ff, #00d68f)", borderRadius: 2 }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10, fontFamily: "'DM Mono', monospace" }}>
            <span style={{ color: "#00e5ff" }}>$639 deployed</span>
            <span style={{ color: "#6b7a99" }}>$4,361 free</span>
          </div>
        </div>
      )}

      {/* Bot list */}
      {(!isMobile || mobileTab === "bots") && (
        <>
          {!isMobile && <div style={{ padding: "10px 16px 6px", fontSize: 9, fontWeight: 600, color: "#3a4460", letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>Bot Status</div>}
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
            {BOTS.map(bot => {
              const st = SS[states[bot.id] || "exploiting"];
              const isAct = active[bot.id];
              const isSel = selected === bot.id;
              return (
                <div key={bot.id} onClick={() => setSelected(s => s === bot.id ? null : bot.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: 8, marginBottom: 2, cursor: "pointer", background: isSel ? "rgba(0,229,255,0.06)" : isAct ? "rgba(255,255,255,0.04)" : "transparent", position: "relative", overflow: "hidden", transition: "background 0.15s" }}>
                  {isAct && <div style={{ position:"absolute", inset:0, background:`linear-gradient(90deg,transparent,${bot.hex}18,transparent)`, animation:"shimmer 1.4s infinite" }} />}
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: bot.hex+"18", border: `1px solid ${isAct ? bot.hex+"66" : "rgba(255,255,255,0.05)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, position: "relative" }}>
                    {bot.e}
                    {isAct && <div style={{ position:"absolute", top:-3, right:-3, width:8, height:8, borderRadius:"50%", background:bot.hex, boxShadow:`0 0 8px ${bot.hex}` }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: isAct ? "#f0f2f8" : "rgba(240,242,248,0.55)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{bot.label}</div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: st.fg, letterSpacing: "0.08em", fontFamily: "'DM Mono', monospace", marginTop: 1 }}>{st.label}</div>
                  </div>
                  {isAct && <div style={{ width: 5, height: 5, borderRadius: "50%", background: bot.hex, boxShadow: `0 0 6px ${bot.hex}`, flexShrink: 0, animation: "blink 0.7s infinite" }} />}
                </div>
              );
            })}
            {selBot && (
              <div style={{ margin: "6px 0 2px", padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ fontSize: 11, color: selBot.hex, fontWeight: 600, marginBottom: 2 }}>{selBot.e} {selBot.label}</div>
                <div style={{ fontSize: 9, color: SS[states[selBot.id] || "exploiting"].fg, fontFamily: "'DM Mono', monospace" }}>{SS[states[selBot.id] || "exploiting"].label}</div>
                <div style={{ fontSize: 9, color: "#3a4460", marginTop: 4, cursor: "pointer" }} onClick={() => setSelected(null)}>Tap to deselect</div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Activity feed */}
      {(!isMobile || mobileTab === "activity") && (
        <>
          {!isMobile && <div style={{ borderTop: "1px solid rgba(255,255,255,0.055)", padding: "10px 16px 6px", fontSize: 9, fontWeight: 600, color: "#3a4460", letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>Activity</div>}
          <div style={{ flex: isMobile ? 1 : "0 0 auto", maxHeight: isMobile ? undefined : 190, overflowY: "auto", padding: "4px 8px 8px" }}>
            {log.slice(0, 10).map((entry, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 8px", borderRadius: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>{entry.e}</span>
                <span style={{ flex: 1, fontSize: 11, color: "#6b7a99", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <strong style={{ color: "rgba(255,255,255,0.65)", fontWeight: 500 }}>{entry.label.split(" ")[0]}</strong> {entry.msg}
                </span>
                <div style={{ width: 4, height: 4, borderRadius: "50%", background: entry.hex, flexShrink: 0, marginTop: 5 }} />
                <span style={{ fontSize: 9, color: "#3a4460", fontFamily: "'DM Mono', monospace", flexShrink: 0, marginTop: 2 }}>{entry.time}</span>
              </div>
            ))}
            {log.length === 0 && <div style={{ padding: "12px 8px", fontSize: 11, color: "#3a4460", fontFamily: "'DM Mono', monospace" }}>Waiting for events...</div>}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div style={{ background: P.bg, height: "100vh", display: "flex", flexDirection: "column", fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", color: "#f0f2f8", overflow: "hidden" }}>

      {/* Top bar */}
      <div style={{ height: 48, borderBottom: "1px solid rgba(255,255,255,0.055)", background: "rgba(6,8,16,0.92)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", padding: "0 16px", gap: 12, flexShrink: 0, zIndex: 100 }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.1em", color: "#f0f2f8" }}>BRAIN</span>
        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.09)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 20, background: rc.bg, border: `1px solid ${rc.color}44` }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: rc.color, boxShadow: `0 0 8px ${rc.color}`, animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 10, fontWeight: 600, color: rc.color, letterSpacing: "0.07em", fontFamily: "'DM Mono', monospace" }}>{rc.label}</span>
        </div>
        {!isMobile && <>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#6b7a99", fontFamily: "'DM Mono', monospace" }}>Capital</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#00e5ff", fontFamily: "'DM Mono', monospace" }}>$5,000.00</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#6b7a99", fontFamily: "'DM Mono', monospace" }}>P&L</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#00d68f", fontFamily: "'DM Mono', monospace" }}>+$3.64</span>
          </div>
        </>}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "'DM Mono', monospace", color: "#6b7a99" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00d68f", boxShadow: "0 0 8px #00d68f", animation: "pulse 2s infinite" }} />
          <span>PAPER · LIVE</span>
        </div>
        {!isMobile && <span style={{ fontSize: 11, color: "#3a4460", fontFamily: "'DM Mono', monospace", marginLeft: 8 }}>{time}</span>}
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>

        {/* Canvas area */}
        <div ref={wrapRef} style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: isMobile ? 0 : undefined }}>
          <canvas ref={cvs} onClick={handleClick} style={{ display: "block", cursor: "crosshair", width: "100%", height: "100%" }} />

          {/* Bubbles */}
          {bubbles.map(b => {
            const bot = BOTS.find(x => x.id === b.botId);
            if (!bot) return null;
            const { x, y } = sc(bot.c, bot.r + 0.55);
            const age = Math.min(1, (Date.now() - b.born) / 3500);
            const op = age > 0.72 ? 1-(age-0.72)/0.28 : Math.min(1, age*6);
            return (
              <div key={b.id} style={{ position:"absolute", left:`${(x/CW)*100}%`, top:`${((y-90)/CH)*100}%`, transform:"translateX(-50%)", background:"rgba(6,8,16,0.96)", border:`1px solid ${bot.hex}88`, borderRadius:7, padding:"5px 11px", fontSize:11, fontWeight:500, whiteSpace:"nowrap", pointerEvents:"none", zIndex:20, opacity:op, boxShadow:`0 4px 20px rgba(0,0,0,0.5)`, color:"#f0f2f8", transition:"opacity 0.1s" }}>
                {b.msg}
                <div style={{ position:"absolute", bottom:-6, left:"50%", transform:"translateX(-50%)", borderLeft:"5px solid transparent", borderRight:"5px solid transparent", borderTop:`6px solid ${bot.hex}88` }} />
              </div>
            );
          })}
        </div>

        <Sidebar />
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.15} }
        @keyframes shimmer { 0%{transform:translateX(-200%)} 100%{transform:translateX(200%)} }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
      `}</style>
    </div>
  );
}
