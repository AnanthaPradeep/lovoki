// Test-only helper for scripts/real-e2e.py. Talks to the LOCAL Supabase stack (refuses anything else) with the local
// service key printed by `supabase status`. The key never reaches apps/web and is never written to disk.
//   node scripts/real-e2e-helper.mjs env                  -> prints VITE_* values for the dev server (anon key only) plus the mail URL
//   node scripts/real-e2e-helper.mjs seed                 -> creates two people with posts, prints JSON
//   node scripts/real-e2e-helper.mjs accept <G> <A>       -> G accepts A's follow request
//   node scripts/real-e2e-helper.mjs query <table> <col> <value>   -> rows as JSON
//   node scripts/real-e2e-helper.mjs like-as <email> <postId>      -> that person likes a post
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import { postPicture, profilePicture } from './lib/sample-art.mjs';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

// `supabase status` is slow and occasionally stalls, so the caller resolves it once and passes the values down
// through the environment of this child process only (never to disk). Run by hand, it falls back to the CLI.
const env = {};
if (process.env.LOVOKI_HELPER_API_URL) {
  Object.assign(env, { API_URL: process.env.LOVOKI_HELPER_API_URL, ANON_KEY: process.env.LOVOKI_HELPER_ANON, SERVICE_ROLE_KEY: process.env.LOVOKI_HELPER_SERVICE, MAILPIT_URL: process.env.LOVOKI_HELPER_MAIL });
} else {
  const out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'], timeout: 90000 });
  for (const line of out.split(/\r?\n/)) { const m = /^([A-Z_0-9]+)="(.*)"$/.exec(line); if (m) env[m[1]] = m[2]; }
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.API_URL ?? '')) { console.error('Refusing: API_URL is not local'); process.exit(2); }

const opts = (k) => ({ auth: { persistSession: false, autoRefreshToken: false, storageKey: k }, realtime: { transport: WebSocket } });
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, opts('admin'));
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const PW = 'correct-horse-battery-1';
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };


const TERMS = '2026-11-draft-1';
/** Phase 3.5 identity: a handle, recorded consent and a real place id (the places table is read with the admin client here; browsers only see search results). */
async function identity(sb, label, cityName) {
  const handle = (label.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 18) || 'person') + '.' + randomUUID().slice(0, 5);
  must(await sb.rpc('set_username', { p_handle: handle }), 'set_username');
  must(await sb.rpc('record_consent', { p_terms_version: TERMS, p_confirm_18: true }), 'record_consent');
  const rows = must(await admin.from('places').select('id').ilike('name', cityName ?? 'Lisbon').order('population', { ascending: false }).limit(1), 'place lookup');
  const row = rows[0] ?? must(await admin.from('places').select('id').ilike('name', 'Lisbon').limit(1), 'place lookup')[0];
  must(await sb.rpc('save_place_id', { p_place_id: row.id }), 'save_place_id');
  return handle;
}

async function person(label, visibility, city) {
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${randomUUID().slice(0, 6)}@lovoki-e2e.test`;
  const made = must(await admin.auth.admin.createUser({ email, password: PW, email_confirm: true }), 'createUser');
  const sb = createClient(env.API_URL, env.ANON_KEY, opts(email));
  must(await sb.auth.signInWithPassword({ email, password: PW }), 'signIn');
  const id = made.user.id;
  must(await sb.rpc('save_basics', { p_display_name: label, p_date_of_birth: '1994-03-03', p_pronouns: '' }), 'save_basics');
  must(await sb.rpc('save_about', { p_bio: `Real e2e profile of ${label}`, p_interests: [], p_prompts: [] }), 'save_about');
  must(await sb.rpc('save_preferences', { p_intention: 'long-term', p_interested_in: ['women'], p_age_min: 18, p_age_max: 60, p_max_distance: null }), 'save_preferences');
  must(await sb.rpc('save_privacy', { p_area_label: 'Lisbon', p_social_visibility: visibility, p_dating_discoverable: false }), 'save_privacy');
  const path = `${id}/${randomUUID()}.png`;
  must(await sb.storage.from('profile-photos').upload(path, PNG, { contentType: 'image/png' }), 'photo');
  must(await sb.rpc('register_photo', { p_path: path }), 'register_photo');
  const handle = await identity(sb, label, city);
  must(await sb.rpc('save_dating_profile', { p_gender: 'woman', p_show_gender: true, p_show_distance: true }), 'gender');
  must(await sb.rpc('complete_onboarding'), 'complete_onboarding');
  return { id, email, password: PW, sb, handle };
}
async function post(u, caption, audience, image) {
  const id = randomUUID(); let media = null;
  if (image) { media = `${u.id}/${id}/${randomUUID()}.png`; must(await u.sb.storage.from('post-media').upload(media, PNG, { contentType: 'image/png' }), 'media'); }
  must(await u.sb.rpc('create_post', { p_post_id: id, p_caption: caption, p_audience: audience, p_media_path: media }), 'create_post');
  return id;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'env') {
  console.log(JSON.stringify({ VITE_LOVOKI_MODE: 'supabase', VITE_SUPABASE_URL: env.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: env.ANON_KEY, MAIL: env.MAILPIT_URL, _service: env.SERVICE_ROLE_KEY }));
} else if (cmd === 'seed') {
  const open = await person('Beatrice Open', 'public');
  const gate = await person('Gideon Gated', 'followers');
  const p1 = await post(open, 'Beatrice public post with a picture', 'public', true);
  const p2 = await post(open, 'Beatrice followers-only post', 'followers', false);
  const p3 = await post(gate, 'Gideon post behind a request', 'public', true);
  console.log(JSON.stringify({ open: { id: open.id, email: open.email, password: PW, handle: open.handle }, gate: { id: gate.id, email: gate.email, password: PW, handle: gate.handle }, posts: { p1, p2, p3 } }));
} else if (cmd === 'accept') {
  const [gateEmail, followerId] = args;
  const sb = createClient(env.API_URL, env.ANON_KEY, opts('acc'));
  must(await sb.auth.signInWithPassword({ email: gateEmail, password: PW }), 'signIn');
  must(await sb.rpc('respond_follow_request', { p_follower: followerId, p_accept: true }), 'accept');
  console.log('{}');
} else if (cmd === 'query') {
  const [table, col, val] = args;
  console.log(JSON.stringify(must(await admin.from(table).select('*').eq(col, val), 'query')));
} else if (cmd === 'like-as') {
  const [email, postId] = args;
  const sb = createClient(env.API_URL, env.ANON_KEY, opts('like'));
  must(await sb.auth.signInWithPassword({ email, password: PW }), 'signIn');
  must(await sb.rpc('like_post', { p_post: postId }), 'like');
  console.log('{}');
} else if (cmd === 'purge-test-users') { // LOCAL ONLY: removes earlier automated-test accounts so a run starts from a known crowd; reports anyone else
  let n = 0, others = 0;
  const list = must(await admin.auth.admin.listUsers({ perPage: 1000 }), 'list');
  for (const u of list.users) {
    if (/@lovoki-(e2e|it)\.test$/.test(u.email ?? '')) { await admin.auth.admin.deleteUser(u.id); n++; } else others++;
  }
  console.log(JSON.stringify({ removed: n, others }));
} else if (cmd === 'dating-user') { // a fully onboarded dating user: label gender interestedIn(comma) place(lisbon|sintra|madrid)
  const [label, gender, wants, place] = args;
  const city = { lisbon: 'Lisbon', setubal: 'Setúbal', madrid: 'Madrid' }[place ?? 'lisbon'];
  const u = await person(label, 'public', city);
  must(await u.sb.rpc('save_dating_profile', { p_gender: gender, p_show_gender: true, p_show_distance: true }), 'dating profile');
  must(await u.sb.rpc('save_preferences', { p_intention: 'long-term', p_interested_in: wants.split(','), p_age_min: 18, p_age_max: 99, p_max_distance: null }), 'prefs');
  must(await u.sb.rpc('save_privacy', { p_area_label: city, p_social_visibility: 'public', p_dating_discoverable: true }), 'discoverable');
  console.log(JSON.stringify({ id: u.id, email: u.email, password: PW, handle: u.handle }));
} else if (cmd === 'profile-user') { // Phase 4.5: a finished account with a chosen avatar (with blurhash) and N posts that have thumbnails: label visibility(public|followers) postCount
  const [label, vis, nStr] = args; const n = Number(nStr ?? 4);
  const u = await person(label, vis ?? 'public', 'Lisbon');
  const avatar = await profilePicture(label, 0, label, 0);
  const apath = `${u.id}/${randomUUID()}.jpg`;
  must(await u.sb.storage.from('profile-photos').upload(apath, avatar.buf, { contentType: 'image/jpeg' }), 'avatar upload');
  const photoId = must(await u.sb.rpc('register_photo', { p_path: apath }), 'register avatar');
  must(await u.sb.rpc('save_avatar', { p_photo_id: photoId, p_crop: { x: 0.5, y: 0.5, zoom: 1 }, p_blurhash: avatar.blurhash }), 'save_avatar');
  const posts = [];
  for (let i = 0; i < n; i++) {
    const pic = await postPicture(`${label}:${i}`, i % 2 === 0); const id = randomUUID();
    const main = `${u.id}/${id}/${randomUUID()}.jpg`, thumb = `${u.id}/${id}/${randomUUID()}.jpg`;
    must(await u.sb.storage.from('post-media').upload(main, pic.original, { contentType: 'image/jpeg' }), 'post upload');
    must(await u.sb.storage.from('post-media').upload(thumb, pic.thumb, { contentType: 'image/jpeg' }), 'thumb upload');
    must(await u.sb.rpc('create_post', { p_post_id: id, p_caption: `${label} post ${i + 1}`, p_audience: 'public', p_media_path: main, p_thumb_path: thumb, p_width: pic.width, p_height: pic.height, p_blurhash: pic.blurhash }), 'create_post');
    posts.push({ id, main, thumb });
  }
  console.log(JSON.stringify({ id: u.id, email: u.email, password: PW, handle: u.handle, posts }));
} else if (cmd === 'like-profile-as') { // that person likes a profile (dating)
  const [email, target] = args;
  const sb = createClient(env.API_URL, env.ANON_KEY, opts('dl'));
  must(await sb.auth.signInWithPassword({ email, password: PW }), 'signIn');
  console.log(JSON.stringify(must(await sb.rpc('like_profile', { p_target: target }), 'like_profile')));
} else if (cmd === 'pause-as') {
  const [email, on] = args;
  const sb = createClient(env.API_URL, env.ANON_KEY, opts('pz'));
  must(await sb.auth.signInWithPassword({ email, password: PW }), 'signIn');
  must(await sb.rpc('save_privacy', { p_area_label: 'Lisbon', p_social_visibility: 'public', p_dating_discoverable: on === 'on' }), 'save_privacy');
  console.log('{}');
} else { console.error('unknown command'); process.exit(1); }
process.exit(0);
