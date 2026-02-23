/** Supabase client for browser (anon key). */

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url) throw new Error('Missing env VITE_SUPABASE_URL');
if (!anonKey) throw new Error('Missing env VITE_SUPABASE_ANON_KEY');

export const supabase = createClient(url, anonKey);
