import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';

// VITE_LOCAL=1 forces local-only mode (used for testing)
export const REMOTE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY) && import.meta.env.VITE_LOCAL !== '1';

export const supabase: SupabaseClient | null = REMOTE
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'money-auth' },
    })
  : null;
