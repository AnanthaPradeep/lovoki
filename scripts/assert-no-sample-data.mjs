// Release guard: exits NON-ZERO if sample (is_sample) rows exist and the target is, or is declared to be, production.
// Phase 6 (release prep) runs this against the production project before every release. It writes nothing.
//
//   node scripts/assert-no-sample-data.mjs                              # local stack (scripts/.seed.env); prints counts, exits 1 only if environment = production
//   node scripts/assert-no-sample-data.mjs --expect production          # treat the target as production no matter what app_config says (use this in the release pipeline)
//   node scripts/assert-no-sample-data.mjs --hosted --confirm-ref <ref> # hosted project; needs scripts/.seed.hosted.env (SEED_URL, SEED_SERVICE_KEY), git-ignored
//
// Exit codes: 0 clean (or sample rows present on a development target), 1 SAMPLE DATA FOUND ON PRODUCTION, 2 could not check (a missing or wrong setting is a failure, never a pass).
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m, c = 2) => { console.error(m); process.exit(c); };

const readEnvFile = (rel, re) => {
  const f = fileURLToPath(new URL(rel, import.meta.url)); if (!existsSync(f)) return null;
  const out = {}; for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = re.exec(l); if (m) out[m[1]] = m[2]; } return out;
};
let url, key;
if (argv.includes('--hosted')) {
  const ref = opt('--confirm-ref'); if (!ref) die('--hosted needs --confirm-ref <project ref>.');
  const e = readEnvFile('./.seed.hosted.env', /^(SEED_URL|SEED_SERVICE_KEY)=(.*)$/);
  if (!e?.SEED_URL || !e?.SEED_SERVICE_KEY) die('Missing scripts/.seed.hosted.env (SEED_URL, SEED_SERVICE_KEY).');
  if (e.SEED_URL !== `https://${ref}.supabase.co`) die('SEED_URL does not match the confirmed project ref.');
  url = e.SEED_URL; key = e.SEED_SERVICE_KEY;
} else {
  const e = process.env.LOVOKI_SEED_API_URL ? { API_URL: process.env.LOVOKI_SEED_API_URL, SERVICE_ROLE_KEY: process.env.LOVOKI_SEED_SERVICE_KEY } : readEnvFile('./.seed.env', /^([A-Z_0-9]+)="(.*)"$/);
  if (!e) die('Missing scripts/.seed.env (npx supabase status -o env > scripts/.seed.env).');
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(e.API_URL ?? '')) die(`Without --hosted the API_URL must be local (got ${e.API_URL ?? 'nothing'}).`);
  url = e.API_URL; key = e.SERVICE_ROLE_KEY;
}
if (!key) die('No service key available.');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'assert-no-sample' }, realtime: { transport: WebSocket } });

const cfg = await admin.from('app_config').select('environment').maybeSingle();
if (cfg.error || !cfg.data) die(`Cannot read app_config (${cfg.error?.message ?? 'no row'}). The Phase 4.5 migration must be applied. Treating this as a failure.`);
const environment = cfg.data.environment;
const expectProd = opt('--expect') === 'production';
const count = async (t) => { const r = await admin.from(t).select('*', { count: 'exact', head: true }).eq('is_sample', true); if (r.error) die(`Cannot count ${t}: ${r.error.message}`); return r.count ?? 0; };
const found = { profiles: await count('profiles'), posts: await count('posts'), post_comments: await count('post_comments') };
const total = found.profiles + found.posts + found.post_comments;
const prod = environment === 'production' || expectProd;

console.log(`target ${url} | app_config.environment = ${environment}${expectProd ? ' | declared production' : ''}`);
console.log(`sample rows: ${found.profiles} profiles, ${found.posts} posts, ${found.post_comments} comments`);
if (prod && total > 0) { console.error('FAIL: sample data exists on a production target. Remove it with: node scripts/seed-sample-content.mjs --remove'); process.exit(1); }
console.log(prod ? 'OK: production has no sample data.' : 'OK: development target (sample data is allowed here).');
process.exit(0);
