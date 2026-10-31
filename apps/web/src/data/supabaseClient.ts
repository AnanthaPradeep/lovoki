import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Browser-safe client: URL + anon/publishable key only. PKCE flow; callbacks are handled explicitly by /auth/callback. */
export function getSupabase(cfg: { url: string; anonKey: string }): SupabaseClient {
  client ??= createClient(cfg.url, cfg.anonKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey: 'lovoki.auth' },
  });
  return client;
}
