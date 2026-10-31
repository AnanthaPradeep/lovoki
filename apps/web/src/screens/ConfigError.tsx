import { TriangleAlert } from 'lucide-react';

/** Shown when real mode is requested but misconfigured. Deliberately does NOT fall back to demo data. */
export function ConfigError({ problems }: { problems: string[] }) {
  return (
    <main className="page" style={{ paddingTop: 64 }} id="main">
      <div className="card card-pad stack">
        <div className="row"><TriangleAlert size={24} aria-hidden /><h1 style={{ fontSize: 'var(--fs-heading)' }}>LOVOKI isn’t configured</h1></div>
        <p className="muted">The app was asked to run with real accounts, but its configuration has problems. It will not silently switch to demo data.</p>
        <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: 20 }}>{problems.map((p) => <li key={p} className="break">{p}</li>)}</ul>
        <p className="subtle">Fix <code>apps/web/.env.local</code> (see <code>.env.example</code> and <code>docs/PHASE_2_SETUP.md</code>), then restart the dev server. For the sample-data experience set <code>VITE_LOVOKI_MODE=demo</code>.</p>
      </div>
    </main>
  );
}
