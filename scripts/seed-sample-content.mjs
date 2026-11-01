// SAMPLE CONTENT for DEVELOPMENT only: 30 fictional adults, 240+ posts, a follow graph, likes, saves and comments, all
// flagged is_sample. Deterministic (same inputs, same rows) and idempotent (a second run changes nothing).
//
//   Local (default):   npx supabase status -o env > scripts/.seed.env        (git-ignored, never commit or paste it)
//                      node scripts/seed-sample-content.mjs                   # prints the plan, asks, then writes
//                      node scripts/seed-sample-content.mjs --yes             # local only: skip the question
//                      node scripts/seed-sample-content.mjs --remove          # delete every sample account and its files
//                      node scripts/seed-sample-content.mjs --users 12        # fewer people (posts scale with them)
//
//   Hosted (only after you approve it):
//                      node scripts/seed-sample-content.mjs --hosted --confirm-ref <project-ref>
//                      needs scripts/.seed.hosted.env (git-ignored) with two lines:  SEED_URL=https://<ref>.supabase.co  SEED_SERVICE_KEY=...
//                      and refuses unless the project's app_config says environment = 'development'. You must type the ref again to proceed.
//
// Sample accounts cannot log in (a random password nobody sees, plus a permanent ban), cannot match, cannot be messaged,
// receive no notifications, and cannot be reported. Never run this against production: see docs/SAMPLE_CONTENT.md.
import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { AVATAR_STYLES, hashSeed, postPicture, profilePicture, rng } from './lib/sample-art.mjs';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };

/* ------------------------------------------------------------------ target and safety gates */

const readEnvFile = (rel, re) => {
  const file = fileURLToPath(new URL(rel, import.meta.url));
  if (!existsSync(file)) return null;
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) { const m = re.exec(line); if (m) out[m[1]] = m[2]; }
  return out;
};

// One prompt style for everything: readline. For the key, the echo is switched off so nothing appears on screen.
const askHidden = (q) => new Promise((resolve) => {
  if (!process.stdin.isTTY) { process.stdout.write(q + String.fromCharCode(10)); resolve(''); return; } // no keyboard attached: nothing to ask
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false; let done = false;
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (str) => { if (!muted) write(str); };
  rl.on('close', () => { if (!done) { done = true; resolve(''); } });
  rl.question(q, (a) => { done = true; rl.close(); process.stdout.write('\n'); resolve(a.trim()); });
  muted = true; // everything typed after the question is shown is hidden
});

let URL_, SERVICE;
const hosted = flag('--hosted');
if (hosted) {
  const ref = opt('--confirm-ref');
  if (!ref || !/^[a-z0-9]{20}$/.test(ref)) die('Hosted seeding needs --confirm-ref <your 20 character project ref>. Nothing was done.', 2);
  let env = readEnvFile('./.seed.hosted.env', /^(SEED_URL|SEED_SERVICE_KEY)=(.*)$/);
  if (!env?.SEED_SERVICE_KEY) {
    // No file: ask for the key here. It is typed hidden, kept in memory for this run only, and never written anywhere.
    const key = await askHidden('Paste the service_role (secret) key. Nothing is shown and nothing is saved: ');
    if (!key) die('No key entered. Nothing was done.', 2);
    env = { SEED_URL: `https://${ref}.supabase.co`, SEED_SERVICE_KEY: key };
  }
  if (!env?.SEED_URL) env.SEED_URL = `https://${ref}.supabase.co`;
  if (env.SEED_URL !== `https://${ref}.supabase.co`) die('SEED_URL does not match the project ref you confirmed. Nothing was done.', 2);
  URL_ = env.SEED_URL; SERVICE = env.SEED_SERVICE_KEY;
} else {
  // The integration tests pass the local stack's values through the environment instead of the file.
  const env = process.env.LOVOKI_SEED_API_URL ? { API_URL: process.env.LOVOKI_SEED_API_URL, SERVICE_ROLE_KEY: process.env.LOVOKI_SEED_SERVICE_KEY } : readEnvFile('./.seed.env', /^([A-Z_0-9]+)="(.*)"$/);
  if (!env) die('Missing scripts/.seed.env. Create it with:  npx supabase status -o env > scripts/.seed.env', 1);
  URL_ = env.API_URL; SERVICE = env.SERVICE_ROLE_KEY;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_ ?? '')) die(`Refusing: without --hosted the API_URL must be a local address (got ${URL_ ?? 'nothing'}).`, 2);
  if (!SERVICE) die('scripts/.seed.env must contain SERVICE_ROLE_KEY from `supabase status`.', 1);
}
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'seed-sample' }, realtime: { transport: WebSocket },
  // A request that hangs becomes an error with a message, instead of a silent freeze.
  global: { fetch: (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(60_000) }) } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };

const cfg = await admin.from('app_config').select('environment').maybeSingle();
if (cfg.error || !cfg.data) {
  const m = cfg.error?.message ?? 'no row';
  const kind = SERVICE.startsWith('sb_publishable_') || /"role":"anon"/.test(Buffer.from(SERVICE.split('.')[1] ?? '', 'base64url').toString()) ? 'The key in your file is the PUBLISHABLE/anon key. This script needs the SECRET (service_role) key.'
    : /schema cache|PGRST20[25]/.test(m) ? 'The API has not noticed the new table yet. In the Supabase SQL editor run:  notify pgrst, "reload schema";  then try again.'
    : /JWT|Invalid API key|apikey/i.test(m) ? 'The key was rejected. Copy the service_role (secret) key again, with no spaces or quotes.' : 'Is the Phase 4.5 migration applied?';
  die(`Cannot read app_config: ${m}
${kind}
Nothing was done.`, 2);
}
if (cfg.data.environment !== 'development') die(`Refusing: app_config.environment is "${cfg.data.environment}". Sample content exists only in development.`, 2);

// Closed input (a pipe, a CI job) counts as "no": the callback form lets us answer '' when stdin ends instead of waiting forever.
const ask = (q) => new Promise((resolve) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout }); let answered = false;
  rl.on('close', () => { if (!answered) resolve(''); });
  rl.question(q, (a) => { answered = true; rl.close(); resolve(a.trim()); });
});
const EMAIL_DOMAIN = '@sample.lovoki.invalid'; // reserved TLD: can never receive mail

/* ------------------------------------------------------------------ remove */

if (flag('--remove')) {
  const users = [];
  for (let page = 1; ; page++) { const l = must(await admin.auth.admin.listUsers({ page, perPage: 200 }), 'list users').users; users.push(...l); if (l.length < 200) break; }
  const samples = users.filter((u) => u.email?.endsWith(EMAIL_DOMAIN));
  const flagged = new Set(must(await admin.from('profiles').select('user_id').eq('is_sample', true), 'flagged').map((r) => r.user_id));
  const targets = samples.filter((u) => flagged.has(u.id)); // both signals, so a real account can never be removed by mistake
  console.log(`Target: ${hosted ? URL_ : 'local stack'}. Will delete ${targets.length} sample accounts, their posts, follows, comments and stored files.`);
  if (!flag('--yes') || hosted) { const a = await ask(hosted ? `Type the project ref to confirm: ` : `Type "remove" to continue: `); if (a !== (hosted ? opt('--confirm-ref') : 'remove')) die('Cancelled. Nothing was deleted.', 3); }
  const list = async (bucket, prefix) => { const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000 }); return data ?? []; };
  for (const u of targets) {
    for (const bucket of ['profile-photos', 'post-media']) {
      const top = await list(bucket, u.id); const files = [];
      for (const o of top) { if (o.id === null) for (const f of await list(bucket, `${u.id}/${o.name}`)) files.push(`${u.id}/${o.name}/${f.name}`); else files.push(`${u.id}/${o.name}`); }
      if (files.length) await admin.storage.from(bucket).remove(files);
    }
    must(await admin.auth.admin.deleteUser(u.id), `delete ${u.email}`);
  }
  console.log(`Removed ${targets.length} sample accounts.`); process.exit(0);
}

/* ------------------------------------------------------------------ the cast (all fictional) */

const COUNT = Math.min(30, Math.max(2, Number(opt('--users') ?? 30)));
const NOW = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 12); // stable within a day
const uuidOf = (key) => { const h = createHash('md5').update(`lovoki-sample:${key}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };

const CAST = [
  ['Meera Velan', 'woman', 'Chennai', 27], ['Arjun Narayan', 'man', 'Coimbatore', 31], ['Kavya Pillai', 'woman', 'Kochi', 29], ['Rohan Kapoor', 'man', 'Delhi', 34],
  ['Ananya Sundar', 'woman', 'Bengaluru', 26], ['Vikram Menon', 'man', 'Thiruvananthapuram', 38], ['Divya Rao', 'woman', 'Mysuru', 24], ['Karthik Iyer', 'man', 'Madurai', 33],
  ['Priya Desai', 'woman', 'Mumbai', 30], ['Aditya Bose', 'man', 'Pune', 28], ['Nisha Thakral', 'non-binary', 'Chennai', 25], ['Siddharth Lal', 'man', 'Bengaluru', 41],
  ['Lakshmi Varma', 'woman', 'Kochi', 36], ['Rahul Dutta', 'man', 'Mumbai', 22], ['Isha Malhotra', 'woman', 'Delhi', 32], ['Varun Shetty', 'man', 'Coimbatore', 35],
  ['Tara Winslow', 'woman', 'London', 29], ['Nikhil Ahuja', 'man', 'Toronto', 27], ['Zara Hollis', 'non-binary', 'Berlin', 26], ['Dev Karmakar', 'man', 'Singapore', 40],
  ['Amelia Carrow', 'woman', 'Sydney', 31], ['Lukas Brandt', 'man', 'Berlin', 34], ['Sofia Marchetti', 'woman', 'London', 23], ['Noah Penhale', 'man', 'Toronto', 45],
  ['Mei Lindqvist', 'woman', 'Singapore', 28], ['Omar Haddad', 'man', 'Sydney', 37], ['Chloe Ashby', 'woman', 'London', 33], ['Jonas Ekberg', 'man', 'Berlin', 30],
  ['Aisha Rahman', 'woman', 'Mumbai', 21], ['Leo Santoro', 'non-binary', 'Toronto', 39],
].slice(0, COUNT);
const CITY_NAMES = { Chennai: ['Chennai'], Coimbatore: ['Coimbatore'], Kochi: ['Kochi', 'Cochin'], Delhi: ['New Delhi', 'Delhi'], Bengaluru: ['Bengaluru', 'Bangalore'], Thiruvananthapuram: ['Thiruvananthapuram', 'Trivandrum'],
  Mysuru: ['Mysuru', 'Mysore'], Madurai: ['Madurai'], Mumbai: ['Mumbai', 'Bombay'], Pune: ['Pune'], London: ['London'], Toronto: ['Toronto'], Berlin: ['Berlin'], Singapore: ['Singapore'], Sydney: ['Sydney'] };
const COUNTRY = { Chennai: 'IN', Coimbatore: 'IN', Kochi: 'IN', Delhi: 'IN', Bengaluru: 'IN', Thiruvananthapuram: 'IN', Mysuru: 'IN', Madurai: 'IN', Mumbai: 'IN', Pune: 'IN', London: 'GB', Toronto: 'CA', Berlin: 'DE', Singapore: 'SG', Sydney: 'AU' };
const INTENTIONS = ['long-term', 'long-term-open', 'short-term-open', 'figuring-out', 'friends-first'];
const INTERESTED = [['men'], ['women'], ['women', 'men'], ['men', 'women', 'non-binary'], ['women'], ['men'], ['women', 'non-binary'], ['men', 'non-binary']];
const BIOS = ['Filter coffee evangelist. ☕ Weekend trekker, weekday overthinker.', 'Cooks a mean rasam and a worse spreadsheet.\nAsk me about my plants 🌿', 'Photographer of puddles and doorways. 📷', 'Slow runner, fast talker. 🏃',
  'Trying to read more than I buy. Failing happily. 📚', 'Dog person who is learning to be a cat person.', 'Carnatic on Sundays, indie on Mondays 🎶', 'Part-time chef, full-time snacker 🍜', 'Software by day, sketchbook by night ✏️',
  'Sea, sunsets and bad puns 🌊', 'I laugh at my own jokes first. Someone has to.', 'Looking for good conversation and better biryani.', 'Cycling to nowhere in particular 🚲', 'Tea over coffee. Fight me, gently. 🍵'];
const PROMPTS = [['A perfect Sunday', ['Filter coffee, a long walk, and no plans after noon.', 'A beach, a book and a very late lunch.', 'Farmers market, then cooking for whoever turns up.']],
  ['I geek out on', ['Old maps, and how cities grew around rivers.', 'Typography. Yes, really.', 'Monsoon cloud-watching and chai ratios.']], ['My simple pleasures', ['The smell of rain on hot ground.', 'A seat by the window on a train.', 'Fresh sheets, a fan, and a podcast.']],
  ['Green flags I look for', ['Kind to waiters, curious about everything.', 'Says sorry first, and means it.']], ['Unpopular opinion', ['Pineapple belongs on pizza and curd rice.', 'The last biscuit is nobody’s.']]];
const JOBS = ['Product designer', 'Nurse', 'Software engineer', 'Teacher', 'Architect', 'Chef', 'Photographer', 'Data analyst', 'Physiotherapist', 'Writer'];
const LANGS = [['en', 'ta'], ['en', 'ml'], ['en', 'hi'], ['en', 'kn'], ['en', 'te'], ['en', 'hi', 'mr'], ['en'], ['en', 'de'], ['en', 'fr']];
const SHORT = ['Golden hour, finally.', 'Monday mood 😌', 'No filter, only filter coffee ☕', 'This view, though.', 'Sunday reset', 'Found this on my walk 🌿', 'Made it myself!', 'Rainy day setup ☔', 'Weekend plans: none. Perfect.', '✨', 'Little things.'];
const LONGER = ['Went back to the old neighbourhood today. The bakery is still there, the uncle at the corner still remembers my order, and somehow everything is smaller than I recall. Funny how places shrink while you grow. Might make this a monthly ritual: walk, bread, no phone.',
  'A few things I learned this week: 1) You can not rush good tea. 2) Buses are late exactly when you are early. 3) A five minute call to a friend fixes more than a five hour scroll. 4) Plants forgive. People mostly do too. 🌱',
  'Trying something new: one photo a day, no editing, no hashtags. Day 12 and I am already noticing more light, more edges, more strangers carrying shopping bags with great dignity. If you see me crouching in a doorway, I am not lost. I am composing.'];
const VERY_LONG = ('Long caption test. ' + 'The monsoon came early this year and the whole street smelled of wet earth and fried snacks. '.repeat(18) + 'Okay, that is enough from me. 🌧️').slice(0, 1400);
const COMMENTS = ['Love this!', 'Great colours 😍', 'Where is this?', 'This made my day', 'Okay wow.', 'Need this energy 🙌', 'So calm.', 'Saving this one', 'Beautiful light', 'Ha, same!', 'Tell me more?', 'Obsessed with this 🌿'];

const isPrivate = (i) => i % 10 === 2 || i % 10 === 5 || i % 10 === 8; // 9 of 30 private (30%)
const handleOf = (name) => name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
const people = CAST.map(([name, gender, city, age], i) => {
  const r = rng(hashSeed(`person:${name}`));
  const postsN = isPrivate(i) ? 5 + Math.floor(r() * 3) : 6 + Math.floor(r() * 7);
  return { i, name, gender, city, age, id: uuidOf(`user:${i}`), handle: handleOf(name), private: isPrivate(i), postsN, photosN: 3 + Math.floor(r() * 4), style: i % AVATAR_STYLES.length,
    discoverable: i % 5 !== 4, intention: INTENTIONS[i % INTENTIONS.length], interested: INTERESTED[i % INTERESTED.length], bio: BIOS[(i * 7) % BIOS.length], r };
});
const totalPosts = people.reduce((n, p) => n + p.postsN, 0);

console.log(`\nTarget : ${hosted ? URL_ : 'LOCAL stack ' + URL_}   (app_config.environment = development)`);
console.log(`Creates: ${people.length} sample accounts (${people.filter((p) => p.private).length} private, ${people.filter((p) => !p.private).length} public), about ${totalPosts} posts each with a picture and a 400 px thumbnail,`);
console.log(`         ${people.reduce((n, p) => n + p.photosN, 0)} profile photos, a follow graph, likes, saves and short comments. Everything is flagged is_sample.`);
console.log('Accounts: @sample.lovoki.invalid addresses, random discarded passwords, permanently banned: nobody can log in as them.\n');
if (hosted) { const a = await ask('HOSTED. Type the project ref to write: '); if (a !== opt('--confirm-ref')) die('Cancelled. Nothing was written.', 3); }
else if (!flag('--yes')) { const a = await ask('Type "seed" to write this to your local stack: '); if (a !== 'seed') die('Cancelled. Nothing was written.', 3); }
console.log('Confirmed. Looking up the cities…');

/* ------------------------------------------------------------------ helpers */

const BATCH = 100;
async function upsert(table, rows, onConflict, ignoreDuplicates = false) {
  for (let i = 0; i < rows.length; i += BATCH) must(await admin.from(table).upsert(rows.slice(i, i + BATCH), { onConflict, ignoreDuplicates }), `${table} upsert`);
}
async function pool(items, n, fn) { let k = 0; await Promise.all(Array.from({ length: n }, async () => { while (k < items.length) { const it = items[k++]; await fn(it); } })); }
const put = async (bucket, path, buf) => must(await admin.storage.from(bucket).upload(path, buf, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' }), `upload ${path}`);

const cityId = {};
for (const city of new Set(people.map((p) => p.city))) {
  process.stdout.write(`  city ${city}
`);
  for (const n of CITY_NAMES[city]) {
    const rows = must(await admin.from('places').select('id,name,region,lat,lng,country_code,population').ilike('name', n).eq('country_code', COUNTRY[city]).order('population', { ascending: false }).limit(1), `place ${n}`);
    if (rows[0]) { cityId[city] = rows[0]; break; }
  }
  if (!cityId[city]) die(`The places table has no city for ${city}. Apply the Phase 3.5 places migration first.`, 2);
}

/* ------------------------------------------------------------------ accounts and profile rows */

console.log('Reading existing accounts…');
const existing = new Map();
for (let page = 1; ; page++) { const l = must(await admin.auth.admin.listUsers({ page, perPage: 200 }), 'list users').users; l.forEach((u) => existing.set(u.id, u)); if (l.length < 200) break; }
const interestSlugs = must(await admin.from('interests').select('slug'), 'interests').map((x) => x.slug);
let created = 0;
console.log(`Creating ${people.filter((p) => !existing.has(p.id)).length} accounts…`);
await pool(people, 3, async (p) => {
  if (!existing.has(p.id)) {
    const res = await admin.auth.admin.createUser({ id: p.id, email: `sample-${p.handle.replace(/\./g, '-')}${EMAIL_DOMAIN}`, password: randomBytes(24).toString('base64url'), email_confirm: true, ban_duration: '876000h',
      user_metadata: { terms_version: '2026-11-draft-1', confirm_18: 'true', marketing: 'false', sample: 'true' } });
    if (res.error) throw new Error(`createUser ${p.handle}: ${res.error.message}`);
    created++; console.log(`  account ${created}: ${p.handle}`);
  }
});
console.log(`Accounts: ${created} created, ${people.length - created} already there.`);

const place = (c) => cityId[c];
const gridded = (v) => Math.round(Number(v) * 20) / 20; // the same 0.05 degree grid save_place_id uses
await pool(people, 4, async (p) => {
  const pl = place(p.city); const r = p.r;
  must(await admin.from('profiles').update({ is_sample: true }).eq('user_id', p.id), 'flag sample'); // first: later rows inherit the flag
  const photos = [];
  for (let k = 0; k < p.photosN; k++) {
    const pic = await profilePicture(`${p.handle}`, k, `${p.handle}`, p.style);
    const path = `${p.id}/${uuidOf(`photo:${p.i}:${k}`)}.jpg`; await put('profile-photos', path, pic.buf);
    photos.push({ id: uuidOf(`photorow:${p.i}:${k}`), user_id: p.id, storage_path: path, position: k, content_type: 'image/jpeg', size_bytes: pic.buf.length, blurhash: pic.blurhash });
  }
  await upsert('profile_photos', photos.map(({ blurhash: _b, ...x }) => x), 'id');
  const prompts = [PROMPTS[(p.i + 0) % PROMPTS.length], PROMPTS[(p.i + 2) % PROMPTS.length]].map(([q, a], idx) => ({ user_id: p.id, position: idx + 1, question: q, answer: a[(p.i + idx) % a.length] }));
  must(await admin.from('profiles').update({
    display_name: p.name, pronouns: p.gender === 'woman' ? 'she/her' : p.gender === 'man' ? 'he/him' : 'they/them', bio: p.bio, intention: p.intention,
    area_label: pl.name + (pl.region && pl.region !== pl.name ? `, ${pl.region}` : ''), social_visibility: p.private ? 'followers' : 'public', dating_discoverable: p.discoverable,
    gender: p.gender, show_gender: true, show_distance: true, username: p.handle, avatar_photo_id: photos[0].id, avatar_crop: { x: 0.5, y: 0.5, zoom: 1 }, avatar_blurhash: photos[0].blurhash,
    allow_comments: 'everyone', show_follower_counts: p.i % 9 !== 4, show_avatar_to_everyone: false, searchable_by_username: true,
  }).eq('user_id', p.id), `profile ${p.handle}`);
  await upsert('profiles_private', [{ user_id: p.id, date_of_birth: `${new Date().getUTCFullYear() - p.age - 1}-${String(1 + (p.i % 12)).padStart(2, '0')}-${String(3 + (p.i % 24)).padStart(2, '0')}` }], 'user_id');
  must(await admin.from('dating_preferences').update({ interested_in: p.interested, age_min: 21, age_max: 50, max_distance_km: null }).eq('user_id', p.id), 'prefs');
  await upsert('profile_places', [{ user_id: p.id, place_id: pl.id, lat: gridded(pl.lat), lng: gridded(pl.lng) }], 'user_id');
  must(await admin.from('profile_interests').delete().eq('user_id', p.id), 'interests clear');
  const mine = [...interestSlugs].sort((a, b) => hashSeed(`${p.handle}${a}`) - hashSeed(`${p.handle}${b}`)).slice(0, 3 + (p.i % 4));
  must(await admin.from('profile_interests').insert(mine.map((slug) => ({ user_id: p.id, slug }))), 'interests');
  await upsert('profile_prompts', prompts, 'user_id,position');
  await upsert('profile_details', [{ user_id: p.id, height_cm: 150 + Math.floor(r() * 45), job_title: JOBS[p.i % JOBS.length], languages: LANGS[p.i % LANGS.length], drinking: ['never', 'rarely', 'socially', 'often'][p.i % 4], smoking: 'never',
    exercise: ['sometimes', 'often', 'daily'][p.i % 3], diet: ['vegetarian', 'non-vegetarian', 'eggetarian', 'vegan', 'pescatarian'][p.i % 5], wants_kids: ['open', 'yes', 'no'][p.i % 3],
    instagram_handle: p.i % 3 === 0 ? `${p.handle.replace(/\./g, '_')}_sample` : null, visibility: { height: ['P', 'F', 'M'][p.i % 3], work: 'P', lifestyle: ['P', 'M', 'X'][p.i % 3], languages: 'P', kids: 'M', instagram: 'M' } }], 'user_id');
  await upsert('onboarding_state', [{ user_id: p.id, current_step: 'review', completed_at: new Date(NOW - (30 - p.i) * 86_400_000).toISOString() }], 'user_id');
});
console.log(`Profiles: ${people.length} written (${people.reduce((n, p) => n + p.photosN, 0)} photos).`);

/* ------------------------------------------------------------------ posts, likes, saves, comments, follows */

const byId = new Map(people.map((p) => [p.id, p]));
const posts = []; const media = [];
for (const p of people) {
  const r = rng(hashSeed(`posts:${p.handle}`));
  for (let n = 0; n < p.postsN; n++) {
    const id = uuidOf(`post:${p.i}:${n}`); const kind = r();
    const caption = kind < 0.12 ? '' : kind < 0.55 ? SHORT[Math.floor(r() * SHORT.length)] : kind < 0.86 ? `${SHORT[Math.floor(r() * SHORT.length)]} ${['🌺', '🍃', '🌇', '🎧', '🍛', '🚆'][Math.floor(r() * 6)]}` : kind < 0.97 ? LONGER[Math.floor(r() * LONGER.length)] : VERY_LONG;
    const withPicture = caption === '' ? true : r() > 0.1;
    const hoursAgo = Math.floor(r() * 60 * 24); // anywhere in the last 60 days
    posts.push({ id, author_id: p.id, caption, audience: r() < (p.private ? 0.5 : 0.14) ? 'followers' : 'public', created_at: new Date(NOW - hoursAgo * 3_600_000).toISOString(), withPicture, square: r() < 0.4, seed: `${p.handle}:${n}`, authorIdx: p.i });
  }
}
await upsert('posts', posts.map(({ id, author_id, caption, audience, created_at }) => ({ id, author_id, caption, audience, created_at })), 'id', true);
let uploaded = 0;
await pool(posts.filter((x) => x.withPicture), 4, async (x) => {
  const pic = await postPicture(x.seed, x.square);
  const base = `${x.author_id}/${x.id}`; const main = `${base}/${uuidOf(`pm:${x.id}`)}.jpg`; const thumb = `${base}/${uuidOf(`pt:${x.id}`)}.jpg`;
  await put('post-media', main, pic.original); await put('post-media', thumb, pic.thumb);
  media.push({ id: uuidOf(`mediarow:${x.id}`), post_id: x.id, user_id: x.author_id, position: 0, storage_path: main, content_type: 'image/jpeg', size_bytes: pic.bytes, kind: 'image', width: pic.width, height: pic.height, blurhash: pic.blurhash, thumb_path: thumb });
  if (++uploaded % 40 === 0) console.log(`  …${uploaded} pictures`);
});
await upsert('post_media', media, 'id', true);
console.log(`Posts: ${posts.length} (${media.length} with pictures).`);

const likes = []; const saves = []; const comments = [];
for (const x of posts) {
  const r = rng(hashSeed(`reactions:${x.id}`));
  const author = byId.get(x.author_id);
  for (const q of people) {
    if (q.id === x.author_id) continue;
    if (author.private && x.audience !== 'followers' && r() > 0.6) continue; // fewer strangers react inside private accounts
    const roll = r();
    const when = new Date(Date.parse(x.created_at) + (1 + Math.floor(r() * 72)) * 3_600_000).toISOString();
    if (roll < 0.28) likes.push({ post_id: x.id, user_id: q.id, created_at: when });
    if (roll > 0.93) saves.push({ post_id: x.id, user_id: q.id, created_at: when });
    if (roll > 0.88 && roll <= 0.96 && Date.parse(when) < NOW) comments.push({ id: uuidOf(`c:${x.id}:${q.i}`), post_id: x.id, author_id: q.id, body: COMMENTS[Math.floor(r() * COMMENTS.length)], created_at: when });
  }
}
await upsert('post_likes', likes, 'post_id,user_id', true); await upsert('post_saves', saves, 'post_id,user_id', true); await upsert('post_comments', comments, 'id', true);
console.log(`Reactions: ${likes.length} likes, ${saves.length} saves, ${comments.length} comments.`);

const follows = []; const seen = new Set();
for (const p of people) {
  const r = rng(hashSeed(`follows:${p.handle}`)); const want = 5 + Math.floor(r() * 9);
  for (let k = 0; k < want; k++) {
    const t = people[Math.floor(r() * people.length)]; const key = `${p.id}>${t.id}`;
    if (t.id === p.id || seen.has(key)) continue; seen.add(key);
    const accepted = !t.private || r() < 0.65; const at = new Date(NOW - Math.floor(r() * 50) * 86_400_000).toISOString();
    follows.push({ follower_id: p.id, followee_id: t.id, status: accepted ? 'accepted' : 'pending', created_at: at, accepted_at: accepted ? at : null });
  }
}
await upsert('follows', follows, 'follower_id,followee_id', true);
console.log(`Follows: ${follows.length} (${follows.filter((f) => f.status === 'pending').length} pending requests to private samples; samples never accept).`);

const c = async (t) => (await admin.from(t).select('*', { count: 'exact', head: true }).eq('is_sample', true)).count;
console.log(`\nDone. is_sample rows now: ${await c('profiles')} profiles, ${await c('posts')} posts, ${await c('post_comments')} comments.`);
console.log('Remove them any time with: node scripts/seed-sample-content.mjs --remove');
