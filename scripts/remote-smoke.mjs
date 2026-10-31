// Anonymous smoke test for a Supabase project. Uses ONLY the publishable (browser) key and creates NO users.
// It proves what the public internet can and cannot do to your project. It does not prove anything about signed-in users:
// that is tests/integration (local stack) and the manual two-account checklist in docs/HOSTED_SETUP.md.
//
//   node scripts/remote-smoke.mjs                 reads VITE_SUPABASE_URL and the key from apps/web/.env.local (untracked)
//   LOVOKI_SMOKE_URL=... LOVOKI_SMOKE_KEY=... node scripts/remote-smoke.mjs     explicit values (for example the local stack)
//
// The key is never printed. Exit code 1 if any check fails.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function fromEnvFile() {
  const f = fileURLToPath(new URL('../apps/web/.env.local', import.meta.url));
  if (!existsSync(f)) return {};
  const out = {};
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return out;
}
const file = fromEnvFile();
const URL_ = (process.env.LOVOKI_SMOKE_URL ?? file.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.LOVOKI_SMOKE_KEY ?? file.VITE_SUPABASE_PUBLISHABLE_KEY ?? file.VITE_SUPABASE_ANON_KEY ?? '';
if (!URL_ || !KEY) { console.error('Missing URL or key. Put VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.local.'); process.exit(1); }
if (/^sb_secret_/.test(KEY) || (KEY.split('.').length === 3 && /service_role/.test(Buffer.from(KEY.split('.')[1], 'base64url').toString()))) {
  console.error('That looks like a SECRET key. Refusing to use it. Use only the publishable key.'); process.exit(2);
}
const where = new URL(URL_).hostname === '127.0.0.1' || new URL(URL_).hostname === 'localhost' ? 'local stack' : new URL(URL_).hostname;

const H = { apikey: KEY, ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}) };
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };
const get = async (path, init = {}) => { const r = await fetch(`${URL_}${path}`, { headers: H, ...init }); const t = await r.text(); return { status: r.status, text: t }; };

// Harmless pure helper functions that PostgreSQL makes callable by everyone by default. They touch no data.
const PURE_HELPERS = new Set(['is_adult_on', 'age_of']);

console.log(`Anonymous smoke test against ${where} (no users are created)`);

// 1) What does the API advertise to an anonymous caller?
const spec = await get('/rest/v1/', { headers: { ...H, Accept: 'application/openapi+json' } });
let paths = [];
try { paths = Object.keys(JSON.parse(spec.text).paths ?? {}); } catch { /* not JSON: keys may be refused, which is fine */ }
const tables = paths.filter((p) => p !== '/' && !p.startsWith('/rpc/'));
const rpcs = paths.filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5));
check('the API schema advertises no tables or views to an anonymous caller', tables.length === 0, `exposed: ${tables.join(', ')}`);
check('the API schema advertises no callable functions except pure helpers', rpcs.every((r) => PURE_HELPERS.has(r)), `exposed: ${rpcs.filter((r) => !PURE_HELPERS.has(r)).join(', ')}`);

// 2) Every table and view we know about is denied (even if the schema lists nothing).
const KNOWN = ['profiles', 'profiles_private', 'dating_preferences', 'onboarding_state', 'profile_interests', 'profile_prompts', 'profile_photos', 'interests', 'public_profiles',
  'posts', 'post_media', 'post_likes', 'post_saves', 'post_comments', 'follows', 'blocks', 'notifications', 'content_reports', 'dating_actions', 'matches', 'dating_exclusions',
  'dating_rate', 'profile_places', 'discoverable_profiles', 'profile_details', 'places', 'consents', 'username_history', 'languages'];
let leaked = false;
for (const t of KNOWN) {
  const r = await get(`/rest/v1/${t}?select=*&limit=1`);
  const denied = r.status >= 400 || r.text.trim() === '[]';
  if (!denied) leaked = true;
  if (/date_of_birth/.test(r.text) && r.status < 400 && r.text.trim() !== '[]') leaked = true;
  check(`anonymous read of ${t} is denied`, denied, `status ${r.status}`);
}
check('no anonymous response contained a date_of_birth', !leaked && !/date_of_birth/.test(spec.text));

// 3) Every function we know about is denied.
for (const fn of ['feed_page', 'like_post', 'follow_user', 'report_content', 'notifications_page', 'block_user', 'create_post', 'can_view_content', 'social_profile', 'discover_profiles',
  'like_profile', 'dating_profile', 'list_matches', 'ensure_account', 'save_basics', 'complete_onboarding', 'register_photo', 'check_username', 'search_places', 'save_place_id', 'orphan_post_media']) {
  const r = await get(`/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}' });
  check(`anonymous call of ${fn}() is denied`, r.status >= 400 && r.status !== 500, `status ${r.status}`);
}

// 4) Storage: both buckets must be private. A public bucket serves /object/public/<bucket>/<path>; a private one answers "Bucket not found".
for (const bucket of ['profile-photos', 'post-media']) {
  const r = await get(`/storage/v1/object/public/${bucket}/smoke-probe.png`);
  check(`storage bucket ${bucket} is not public`, r.status >= 400 && /bucket not found|not_found|Bucket not found/i.test(r.text) && !/Object not found/i.test(r.text.replace(/Bucket not found/gi, '')), `status ${r.status}: ${r.text.slice(0, 80)}`);
  const list = await get(`/storage/v1/object/list/${bucket}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 1 }) });
  check(`anonymous listing of ${bucket} returns nothing`, list.status >= 400 || list.text.trim() === '[]', `status ${list.status}`);
}

// 5) Auth endpoint settings (public by design): report, do not fail.
const settings = await get('/auth/v1/settings');
try {
  const s = JSON.parse(settings.text);
  console.log(`INFO  email sign-up ${s.disable_signup ? 'DISABLED' : 'enabled'}; email confirmation ${s.mailer_autoconfirm ? 'OFF (auto-confirm)' : 'required'}; providers: ${Object.entries(s.external ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`);
  check('email confirmation is required (Confirm email is ON)', !s.mailer_autoconfirm);
} catch { console.log('INFO  could not read /auth/v1/settings'); }

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} FAILED` : ''}.`);
process.exit(failed.length ? 1 : 0);
