// LOCAL-ONLY helper: creates N clearly fake adult test users on your LOCAL Supabase stack so Discover has people to show.
// It refuses any URL that is not localhost, and it never touches a hosted project.
//
//   1. npx supabase status -o env > scripts/.seed.env        (local keys; the file is git-ignored, never commit or paste it)
//   2. node scripts/seed-local-users.mjs [count=20]
//
// Users: seed-person-N@lovoki-seed.test, display name "Seed Person N (fake)", password printed below, all 18+, all fake.
// Re-running skips emails that already exist. Remove them with: node scripts/seed-local-users.mjs --remove
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const envFile = fileURLToPath(new URL('./.seed.env', import.meta.url));
if (!existsSync(envFile)) { console.error('Missing scripts/.seed.env. Create it with:  npx supabase status -o env > scripts/.seed.env'); process.exit(1); }
const env = {};
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = /^([A-Z_0-9]+)="(.*)"$/.exec(line); if (m) env[m[1]] = m[2]; }
const URL_ = env.API_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_ ?? '')) { console.error(`Refusing: API_URL must be a local address (got ${URL_ ?? 'nothing'}).`); process.exit(2); }
if (!env.ANON_KEY || !env.SERVICE_ROLE_KEY) { console.error('scripts/.seed.env must contain ANON_KEY and SERVICE_ROLE_KEY from `supabase status`.'); process.exit(1); }

const opts = (k) => ({ auth: { persistSession: false, autoRefreshToken: false, storageKey: k }, realtime: { transport: WebSocket } });
const admin = createClient(URL_, env.SERVICE_ROLE_KEY, opts('seed-admin'));
const PW = 'seed-password-12345';
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const PLACES = [['Lisbon, Portugal', 38.72, -9.14], ['Sintra, Portugal', 38.8, -9.38], ['Setubal, Portugal', 38.52, -8.89], ['Porto, Portugal', 41.15, -8.61], ['Madrid, Spain', 40.42, -3.7]];
const GENDERS = ['woman', 'man', 'non-binary'];
const INTENTIONS = ['long-term', 'long-term-open', 'short-term-open', 'figuring-out', 'friends-first'];
const INTERESTS = [['coffee', 'jazz'], ['hiking', 'film'], ['cooking'], ['music', 'coding'], ['running', 'poetry']];
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const emailOf = (n) => `seed-person-${n}@lovoki-seed.test`;

if (process.argv.includes('--remove')) {
  const list = must(await admin.auth.admin.listUsers({ perPage: 1000 }), 'list');
  let n = 0; for (const u of list.users) if (u.email?.endsWith('@lovoki-seed.test')) { await admin.auth.admin.deleteUser(u.id); n++; }
  console.log(`Removed ${n} seed users.`); process.exit(0);
}

const count = Math.min(200, Math.max(1, Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20)));
const existing = new Set(must(await admin.auth.admin.listUsers({ perPage: 1000 }), 'list').users.map((u) => u.email));
let made = 0;
for (let n = 1; n <= count; n++) {
  const email = emailOf(n); if (existing.has(email)) continue;
  const u = must(await admin.auth.admin.createUser({ email, password: PW, email_confirm: true }), 'createUser').user;
  const sb = createClient(URL_, env.ANON_KEY, opts(email));
  must(await sb.auth.signInWithPassword({ email, password: PW }), 'signIn');
  const year = new Date().getUTCFullYear() - (22 + (n % 18));
  const [place, lat, lng] = PLACES[n % PLACES.length];
  const rpc = async (fn, args) => must(await sb.rpc(fn, args), fn);
  await rpc('save_basics', { p_display_name: `Seed Person ${n} (fake)`, p_date_of_birth: `${year}-03-15`, p_pronouns: '' });
  await rpc('save_about', { p_bio: `Fake test profile number ${n}. Not a real person.`, p_interests: INTERESTS[n % INTERESTS.length], p_prompts: [{ question: 'A perfect Sunday', answer: 'A fake Sunday for testing.' }] });
  await rpc('save_preferences', { p_intention: INTENTIONS[n % INTENTIONS.length], p_interested_in: ['women', 'men', 'non-binary'], p_age_min: 18, p_age_max: 80, p_max_distance: null });
  await rpc('save_privacy', { p_area_label: place, p_social_visibility: 'public', p_dating_discoverable: true });
  await rpc('save_dating_profile', { p_gender: GENDERS[n % GENDERS.length], p_show_gender: true, p_show_distance: true });
  await rpc('save_place', { p_label: place, p_lat: lat, p_lng: lng });
  const path = `${u.id}/${randomUUID()}.png`;
  must(await sb.storage.from('profile-photos').upload(path, PNG, { contentType: 'image/png' }), 'photo');
  await rpc('register_photo', { p_path: path });
  await rpc('complete_onboarding', {});
  made++;
}
console.log(`Created ${made} fake users (${count - made} already existed). Log in as ${emailOf(1)} / ${PW} to try one. They exist only in your local database.`);
process.exit(0);
