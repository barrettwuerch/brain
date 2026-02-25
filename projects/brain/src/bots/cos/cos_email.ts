// src/bots/cos/cos_email.ts
// Resend integration for Chief of Staff emails.
//
// Setup:
// npm install resend
// .env: RESEND_API_KEY, COS_EMAIL_FROM, COS_EMAIL_TO
//
// Test: npm run dev:test-cos-email

import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const EMAIL_FROM = process.env.COS_EMAIL_FROM ?? 'brain@bearkyler.com';
const EMAIL_TO = process.env.COS_EMAIL_TO ?? 'bear@bearkyler.com';

export type BriefStatus = 'ALL CLEAR' | 'NEEDS INPUT' | 'ATTENTION REQUIRED';

export interface DailyBriefData {
  date: string;
  status: BriefStatus;
  system_state: string;
  capital_usd: number;
  capital_change_pct: number;
  vol_regime: string;
  regime_desk: string;
  action_required: string | null;
  yesterday_summary: string;
  priorities: [string, string, string];
  watching: string[];
}

export interface WeeklyMemoData {
  week_number: number;
  date_range: string;
  capital_performance: string;
  regime_alignment: string;
  pipeline_health: string;
  bottleneck_analysis: string;
  blind_spot_review: string;
  decision_packets: string;
  next_week_priorities: string;
  full_memo_markdown: string;
}

export async function sendDailyBrief(
  data: DailyBriefData,
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  const subject = `[BRAIN] Daily Briefing — ${data.date} — ${data.status}`;

  const capitalSign = data.capital_change_pct >= 0 ? '+' : '';
  const capitalColor = data.capital_change_pct >= 0 ? '#1E6B3C' : '#8B1A1A';
  const stateColor =
    ({
      EXPLOITING: '#1E6B3C',
      CAUTIOUS: '#7D4E00',
      PAUSED: '#8B1A1A',
      DIAGNOSTIC: '#4A1B6D',
      RECOVERING: '#1F4E79',
    } as Record<string, string>)[data.system_state] ?? '#1A1A1A';

  const actionHtml = data.action_required
    ? `<p style="background:#FFF3CD;border-left:4px solid #7D4E00;padding:12px 16px;margin:16px 0;font-family:Arial,sans-serif;font-size:14px;color:#1A1A1A;"><strong>ACTION REQUIRED:</strong> ${escHtml(data.action_required)}</p>`
    : `<p style="background:#D5E8D4;border-left:4px solid #1E6B3C;padding:12px 16px;margin:16px 0;font-family:Arial,sans-serif;font-size:14px;color:#1A1A1A;"><strong>ACTION REQUIRED:</strong> None today.</p>`;

  const watchingHtml =
    data.watching.length > 0
      ? data.watching
          .map(
            (w) => `<li style="font-size:13px;color:#555;font-family:Arial,sans-serif;">${escHtml(w)}</li>`,
          )
          .join('')
      : '<li style="font-size:13px;color:#555;font-family:Arial,sans-serif;">Nothing flagged.</li>';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:4px;overflow:hidden;font-family:Arial,sans-serif;">
  <tr><td style="background:#1F4E79;padding:20px 24px;">
  <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;font-weight:bold;">THE BRAIN</p>
  <p style="margin:4px 0 0;color:#A8C4E0;font-size:13px;">Daily Briefing — ${escHtml(data.date)}</p>
  </td></tr>
  <tr><td style="background:${statusBgColor(data.status)};padding:12px 24px;">
  <p style="margin:0;font-size:13px;font-weight:bold;color:${statusTextColor(data.status)};font-family:Arial,sans-serif;">${escHtml(data.status)}</p>
  </td></tr>
  <tr><td style="padding:20px 24px;border-bottom:1px solid #eee;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
  <td width="33%" style="text-align:center;">
  <p style="margin:0;font-size:11px;color:#888;letter-spacing:1px;">SYSTEM</p>
  <p style="margin:4px 0 0;font-size:16px;font-weight:bold;color:${stateColor};">${escHtml(data.system_state)}</p>
  </td>
  <td width="33%" style="text-align:center;border-left:1px solid #eee;border-right:1px solid #eee;">
  <p style="margin:0;font-size:11px;color:#888;letter-spacing:1px;">CAPITAL</p>
  <p style="margin:4px 0 0;font-size:16px;font-weight:bold;color:#1A1A1A;">$${formatMoney(data.capital_usd)}</p>
  <p style="margin:2px 0 0;font-size:12px;color:${capitalColor};">${capitalSign}${data.capital_change_pct.toFixed(1)}% today</p>
  </td>
  <td width="33%" style="text-align:center;">
  <p style="margin:0;font-size:11px;color:#888;letter-spacing:1px;">REGIME</p>
  <p style="margin:4px 0 0;font-size:16px;font-weight:bold;color:#1A1A1A;">${escHtml(data.vol_regime.toUpperCase())}</p>
  <p style="margin:2px 0 0;font-size:12px;color:#888;">${escHtml(data.regime_desk)} desk</p>
  </td>
  </tr></table>
  </td></tr>
  <tr><td style="padding:16px 24px 0;">${actionHtml}</td></tr>
  <tr><td style="padding:0 24px 16px;">
  <p style="margin:0 0 6px;font-size:11px;color:#888;letter-spacing:1px;font-weight:bold;">YESTERDAY</p>
  <p style="margin:0;font-size:14px;color:#1A1A1A;line-height:1.5;">${escHtml(data.yesterday_summary)}</p>
  </td></tr>
  <tr><td style="padding:0 24px 16px;border-top:1px solid #eee;padding-top:16px;">
  <p style="margin:0 0 10px;font-size:11px;color:#888;letter-spacing:1px;font-weight:bold;">TODAY'S PRIORITIES</p>
  <table width="100%" cellpadding="0" cellspacing="0">
  ${[data.priorities[0], data.priorities[1], data.priorities[2]]
    .map(
      (p, i) => `
  <tr>
  <td width="28" style="vertical-align:top;padding-bottom:8px;">
  <span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:#1F4E79;color:#fff;font-size:11px;font-weight:bold;text-align:center;line-height:20px;">${i + 1}</span>
  </td>
  <td style="font-size:14px;color:#1A1A1A;line-height:1.4;padding-bottom:8px;">${escHtml(p)}</td>
  </tr>`,
    )
    .join('')}
  </table>
  </td></tr>
  <tr><td style="padding:0 24px 24px;border-top:1px solid #eee;padding-top:16px;">
  <p style="margin:0 0 8px;font-size:11px;color:#888;letter-spacing:1px;font-weight:bold;">WATCHING</p>
  <ul style="margin:0;padding-left:18px;">${watchingHtml}</ul>
  </td></tr>
  <tr><td style="background:#f5f5f5;padding:16px 24px;border-top:1px solid #eee;">
  <p style="margin:0;font-size:11px;color:#aaa;">The Brain — Autonomous Trading System</p>
  </td></tr>
  </table>
  </td></tr></table>
  </body></html>`;

  try {
    if (!resend) return { success: false, error: 'Missing RESEND_API_KEY' };

    const { data: result, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      subject,
      html,
      text: buildDailyBriefText(data),
    });
    if (error) return { success: false, error: error.message };
    return { success: true, message_id: (result as any)?.id };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function sendWeeklyMemo(
  data: WeeklyMemoData,
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  const subject = `[BRAIN] Weekly Memo — Week ${data.week_number} — ${data.date_range}`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
  <tr><td align="center">
  <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:4px;overflow:hidden;font-family:Arial,sans-serif;">
  <tr><td style="background:#1F4E79;padding:24px 32px;">
  <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;font-weight:bold;">THE BRAIN — WEEKLY MEMO</p>
  <p style="margin:6px 0 0;color:#A8C4E0;font-size:18px;font-weight:bold;">Week ${data.week_number}</p>
  <p style="margin:4px 0 0;color:#A8C4E0;font-size:13px;">${escHtml(data.date_range)}</p>
  </td></tr>
  <tr><td style="padding:32px;">
  <div style="font-family:'Courier New',monospace;font-size:13px;color:#1A1A1A;line-height:1.7;white-space:pre-wrap;">${escHtml(
    data.full_memo_markdown,
  )}</div>
  </td></tr>
  <tr><td style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #eee;">
  <p style="margin:0;font-size:11px;color:#aaa;">The Brain — Autonomous Trading System — Weekly Strategic Memo</p>
  </td></tr>
  </table>
  </td></tr></table>
  </body></html>`;

  try {
    if (!resend) return { success: false, error: 'Missing RESEND_API_KEY' };

    const { data: result, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      subject,
      html,
      text: data.full_memo_markdown,
    });
    if (error) return { success: false, error: error.message };
    return { success: true, message_id: (result as any)?.id };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusBgColor(s: BriefStatus): string {
  return { 'ALL CLEAR': '#D5E8D4', 'NEEDS INPUT': '#FFF3CD', 'ATTENTION REQUIRED': '#F8D7DA' }[s];
}

function statusTextColor(s: BriefStatus): string {
  return { 'ALL CLEAR': '#1E6B3C', 'NEEDS INPUT': '#7D4E00', 'ATTENTION REQUIRED': '#8B1A1A' }[s];
}

function buildDailyBriefText(data: DailyBriefData): string {
  const sign = data.capital_change_pct >= 0 ? '+' : '';
  return `[BRAIN] Daily Briefing — ${data.date} — ${data.status}
SYSTEM: ${data.system_state}
CAPITAL: $${formatMoney(data.capital_usd)} (${sign}${data.capital_change_pct.toFixed(1)}% today)
REGIME: ${data.vol_regime.toUpperCase()} (${data.regime_desk} desk)
ACTION REQUIRED: ${data.action_required ?? 'None today.'}
YESTERDAY: ${data.yesterday_summary}
TODAY'S PRIORITIES:
1. ${data.priorities[0]}
2. ${data.priorities[1]}
3. ${data.priorities[2]}
WATCHING:
${data.watching.map((w) => `• ${w}`).join('\n') || '• Nothing flagged.'}
---
The Brain — Autonomous Trading System`;
}

// Test: npm run dev:test-cos-email
if (process.argv[1].endsWith('cos_email.ts')) {
  (async () => {
    const result = await sendDailyBrief({
      date: new Date().toISOString().split('T')[0],
      status: 'ALL CLEAR',
      system_state: 'EXPLOITING',
      capital_usd: 10000,
      capital_change_pct: 0,
      vol_regime: 'normal',
      regime_desk: 'crypto',
      action_required: null,
      yesterday_summary: 'System initialized. No trades executed. All bots healthy.',
      priorities: [
        'Run pre-live verification gates before enabling real API key',
        'Populate knowledge library — 10-15 chunks per desk',
        'Confirm Resend email delivery working end-to-end',
      ],
      watching: ['Block 3d CoS bot wiring'],
    });
    console.log(result.success ? `✓ Test email sent. Message ID: ${result.message_id}` : `✗ Send failed: ${result.error}`);
    process.exit(0);
  })();
}
