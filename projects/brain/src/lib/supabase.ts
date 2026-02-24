// THE BRAIN — Supabase client wrapper (single connection point)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

// Anon client for read-only operations (RLS applies)
export const supabase: SupabaseClient = createClient(
  req('SUPABASE_URL'),
  req('SUPABASE_ANON_KEY'),
  { auth: { persistSession: false } },
);

// Service-role client for writes/admin operations (bypasses RLS)
export const supabaseAdmin: SupabaseClient = createClient(
  req('SUPABASE_URL'),
  req('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);
