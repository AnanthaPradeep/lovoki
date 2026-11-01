// Starts the web app against your LOCAL Supabase stack without touching apps/web/.env.local (which may point at hosted).
// Needs: Docker + `npx supabase start`. Uses only the local publishable key; the app never sees a service key.
//   node scripts/dev-local.mjs        then open http://127.0.0.1:5173
import { execFileSync, spawn } from 'node:child_process';
const win = process.platform === 'win32';
const out = execFileSync(win ? 'npx.cmd' : 'npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', shell: win });
const env = {}; for (const l of out.split(/\r?\n/)) { const m = /^([A-Z_0-9]+)="(.*)"$/.exec(l); if (m) env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(env.API_URL ?? '')) { console.error('No local stack found. Run: npx supabase start'); process.exit(1); }
console.log(`Local stack ${env.API_URL}. Open http://127.0.0.1:5173  (mail for sign-up links: ${env.MAILPIT_URL})`);
spawn(win ? 'npx.cmd' : 'npx', ['vite', '--port', '5173', '--strictPort', '--host', '127.0.0.1'], { cwd: new URL('../apps/web', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), shell: win, stdio: 'inherit',
  env: { ...process.env, VITE_LOVOKI_MODE: 'supabase', VITE_SUPABASE_URL: env.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: env.PUBLISHABLE_KEY ?? env.ANON_KEY } });
