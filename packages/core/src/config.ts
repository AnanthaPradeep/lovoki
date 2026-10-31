export type AppConfig =
  | { mode: 'demo' }
  | { mode: 'supabase'; url: string; anonKey: string }
  | { mode: 'error'; problems: string[] };

function jwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1]!.length / 4) * 4, '='));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch { return null; }
}

/**
 * Decides the data mode from build-time env. Demo is the default only when nothing asks for Supabase.
 * A broken Supabase configuration is an error screen, never a silent fall back to demo data.
 */
export function evaluateConfig(env: Record<string, string | undefined>): AppConfig {
  const problems: string[] = [];
  for (const k of Object.keys(env)) {
    if (k.startsWith('VITE_') && /service[_-]?role|secret|private/i.test(k)) problems.push(`${k} must not exist. VITE_ variables are embedded in the public browser bundle.`);
  }
  const mode = (env.VITE_LOVOKI_MODE ?? 'demo').trim().toLowerCase();
  if (mode !== 'demo' && mode !== 'supabase') problems.push(`VITE_LOVOKI_MODE must be "demo" or "supabase" (got "${mode}").`);

  const url = (env.VITE_SUPABASE_URL ?? '').trim();
  // VITE_SUPABASE_PUBLISHABLE_KEY is preferred; VITE_SUPABASE_ANON_KEY is the legacy name. If both are set the preferred one wins.
  const keyName = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim() ? 'VITE_SUPABASE_PUBLISHABLE_KEY' : 'VITE_SUPABASE_ANON_KEY';
  const key = (env[keyName] ?? '').trim();
  if (mode === 'supabase') {
    if (!url) problems.push('VITE_SUPABASE_URL is not set.');
    else {
      try {
        const u = new URL(url);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
        if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) problems.push('VITE_SUPABASE_URL must use https (http is allowed only for localhost).');
      } catch { problems.push('VITE_SUPABASE_URL is not a valid URL.'); }
    }
    if (!key) problems.push('VITE_SUPABASE_PUBLISHABLE_KEY (or the legacy VITE_SUPABASE_ANON_KEY) is not set.');
    else {
      if (key.startsWith('sb_secret_')) problems.push(`${keyName} looks like a secret key. Use only the publishable key in the browser.`);
      const role = jwtRole(key);
      if (role === 'service_role') problems.push(`${keyName} is a service_role key. Remove it now and rotate it in the Supabase dashboard.`);
      else if (role && role !== 'anon') problems.push(`${keyName} has role "${role}". Use the publishable (anon) key.`);
    }
  }
  if (problems.length) return { mode: 'error', problems };
  return mode === 'supabase' ? { mode: 'supabase', url, anonKey: key } : { mode: 'demo' };
}
