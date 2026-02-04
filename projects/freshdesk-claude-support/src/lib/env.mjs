import { z } from 'zod';
import 'dotenv/config';

const schema = z.object({
  // If true, the service will run in placeholder/stub mode and will not
  // require real API keys. This is ideal until you have production secrets.
  USE_STUBS: z
    .string()
    .optional()
    .transform((v) => String(v ?? 'true').toLowerCase() === 'true'),

  FRESHDESK_DOMAIN: z.string().min(1).default('example.freshdesk.com'),
  FRESHDESK_API_KEY: z.preprocess(v => (v === '' ? undefined : v), z.string().optional()),
  FRESHDESK_WEBHOOK_SECRET: z.preprocess(v => (v === '' ? undefined : v), z.string().min(1).optional()),

  // Freshchat (optional)
  FRESHCHAT_API_URL: z.preprocess(v => (v === '' ? undefined : v), z.string().url().optional()),
  FRESHCHAT_API_KEY: z.preprocess(v => (v === '' ? undefined : v), z.string().optional()),
  FRESHCHAT_BOT_AGENT_ID: z.preprocess(v => (v === '' ? undefined : v), z.string().optional()),
  FRESHCHAT_ESCALATION_AGENT_ID: z.preprocess(v => (v === '' ? undefined : v), z.string().optional()),

  ANTHROPIC_API_KEY: z.preprocess(v => (v === '' ? undefined : v), z.string().optional()),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5-20250929'),

  ADMIN_PORTAL_BASE_URL: z.preprocess(v => (v === '' ? undefined : v), z.string().url().optional()),
  ADMIN_PORTAL_API_KEY: z.preprocess(v => (v === '' ? undefined : v), z.string().min(1).optional()),

  RAG_PROVIDER: z.enum(['none', 'pgvector']).default('none'),
  PGVECTOR_URL: z.string().optional(),

  PORT: z.coerce.number().int().positive().default(8787),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8787'),
  LOG_LEVEL: z.string().default('info'),

  REFUND_APPROVAL_THRESHOLD_USD: z.coerce.number().nonnegative().default(50),
  MAX_TOOL_CALLS_PER_TURN: z.coerce.number().int().positive().default(6),
  MAX_TOKENS_PER_TICKET: z.coerce.number().int().positive().default(18000),
});

export function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid env:\n${msg}`);
  }
  const env = parsed.data;

  // Enforce required secrets only when not in stub mode.
  if (!env.USE_STUBS) {
    if (!env.FRESHDESK_API_KEY) throw new Error('Missing FRESHDESK_API_KEY (set USE_STUBS=true to run without keys)');
    if (!env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY (set USE_STUBS=true to run without keys)');
  }

  return env;
}
