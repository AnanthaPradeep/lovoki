import { Database, FlaskConical } from 'lucide-react';

/** Makes the active data mode obvious: always in demo mode, and in development for real mode. */
export function ModeBadge({ mode }: { mode: 'demo' | 'supabase' }) {
  if (import.meta.env.MODE === 'uitest') return <span className="chip chip-demo" title="In-memory fakes for browser UI tests. Not Supabase."><FlaskConical size={12} aria-hidden />UI test fakes</span>;
  if (mode === 'supabase' && !import.meta.env.DEV) return null;
  return mode === 'demo'
    ? <span className="chip chip-demo" title="Local synthetic data. Nothing is saved to a server."><FlaskConical size={12} aria-hidden />Demo data</span>
    : <span className="chip chip-demo" title="Connected to Supabase (development build)"><Database size={12} aria-hidden />Supabase mode</span>;
}
