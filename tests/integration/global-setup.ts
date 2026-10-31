import { execFileSync } from 'node:child_process';

/** Resolves the LOCAL stack from `supabase status`. Refuses anything that is not localhost. Keys are never written to disk. */
export default function setup() {
  let out: string;
  try {
    out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new Error('Local Supabase is not running. Start Docker, then run `npx supabase start` (see docs/PHASE_3_SETUP.md).');
  }
  const env: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) { const m = /^([A-Z_0-9]+)="(.*)"$/.exec(line); if (m) env[m[1]!] = m[2]!; }
  const url = env.API_URL;
  if (!url || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error(`Refusing to run integration tests against a non-local API_URL: ${url}`);
  if (!env.ANON_KEY || !env.SERVICE_ROLE_KEY) throw new Error('Could not read local keys from `supabase status`.');
  process.env.LOVOKI_IT_URL = url;
  process.env.LOVOKI_IT_ANON = env.ANON_KEY;
  process.env.LOVOKI_IT_SERVICE = env.SERVICE_ROLE_KEY; // local demo key, test harness only; never used by apps/web
  process.env.LOVOKI_IT_MAIL = env.MAILPIT_URL ?? '';
  process.env.LOVOKI_IT_DB = env.DB_URL ?? '';
}
