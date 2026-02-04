import { z } from 'zod';
import 'dotenv/config';

const schema = z.object({
  FRESHDESK_DOMAIN: z.string().min(1),
  FRESHDESK_API_KEY: z.string().min(1),
  FRESHDESK_WEBHOOK_SECRET: z.string().min(1).optional(),

  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5-20250929'),

  ADMIN_PORTAL_BASE_URL: z.string().url().optional(),
  ADMIN_PORTAL_API_KEY: z.string().min(1).optional(),

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
  return parsed.data;
}
