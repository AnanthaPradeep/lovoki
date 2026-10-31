import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, expect } from 'vitest';
import WebSocket from 'ws';

export const URL_ = process.env.LOVOKI_IT_URL!;
export const ANON = process.env.LOVOKI_IT_ANON!;
const SERVICE = process.env.LOVOKI_IT_SERVICE!;
export const MAIL = process.env.LOVOKI_IT_MAIL!;

// ws: the Node 20 runtime has no native WebSocket, which supabase-js's realtime client requires at construction.
const opts = (key: string) => ({ auth: { persistSession: false, autoRefreshToken: false, storageKey: `it-${key}` }, realtime: { transport: WebSocket as never } });
/** Service-role client: TEST HARNESS ONLY (create confirmed users, inspect rows). apps/web never sees this key. */
export const admin: SupabaseClient = createClient(URL_, SERVICE, opts('admin'));

export const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
export const JPEG = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'));
export const bigJpeg = (bytes: number) => { const b = new Uint8Array(bytes); b.set(JPEG.slice(0, 3)); return b; };

export interface TestUser { id: string; email: string; name: string; sb: SupabaseClient }
const created: string[] = [];
afterAll(async () => { for (const id of created.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => undefined); });

export const rid = () => randomUUID();
const run = randomUUID().slice(0, 8);

/** Throws with the database message so a failing precondition is visible, and returns data. */
export function must<T>(r: { data: T; error: { message: string } | null }, what = 'call'): T {
  if (r.error) throw new Error(`${what} failed: ${r.error.message}`);
  return r.data;
}
export async function rpc<T = unknown>(u: { sb: SupabaseClient }, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  return must(await u.sb.rpc(fn, args), fn) as T;
}
/** Expects an RPC to fail and returns the message. The message must contain `code`. */
export async function rpcFails(u: { sb: SupabaseClient }, fn: string, args: Record<string, unknown>, code: string) {
  const r = await u.sb.rpc(fn, args);
  expect(r.error, `${fn} should fail with ${code}`).not.toBeNull();
  expect(r.error!.message, `${fn} error text`).toContain(code);
}

export async function createUser(label: string, o: { complete?: boolean; visibility?: 'public' | 'followers'; discoverable?: boolean } = {}): Promise<TestUser> {
  const { complete = true, visibility = 'public', discoverable = false } = o;
  const email = `${label}-${run}-${randomUUID().slice(0, 6)}@lovoki-it.test`;
  const password = 'correct-horse-battery-1';
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error || !made.data.user) throw new Error(`createUser: ${made.error?.message}`);
  created.push(made.data.user.id);
  const sb = createClient(URL_, ANON, opts(email));
  const si = await sb.auth.signInWithPassword({ email, password });
  if (si.error) throw new Error(`signIn: ${si.error.message}`);
  const u: TestUser = { id: made.data.user.id, email, name: label, sb };
  if (complete) await completeProfile(u, visibility, discoverable);
  return u;
}

export const TERMS_VERSION = '2026-11-draft-1';
const handleOf = (label: string) => `${label.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) || 'user'}${randomUUID().replace(/-/g, '').slice(0, 8)}`;

/** Username, consent, gender and a place: the identity a profile needs before it can be completed (Phase 3.5). */
export async function setIdentity(u: TestUser, o: { gender?: 'woman' | 'man' | 'non-binary' | 'self-describe'; custom?: string; place?: PlaceKey | null; showGender?: boolean; showDistance?: boolean; marketing?: boolean } = {}) {
  await rpc(u, 'set_username', { p_handle: handleOf(u.name) });
  await rpc(u, 'record_consent', { p_terms_version: TERMS_VERSION, p_confirm_18: true, p_marketing: o.marketing ?? false });
  await rpc(u, 'save_dating_profile', { p_gender: o.gender ?? 'woman', p_show_gender: o.showGender ?? true, p_show_distance: o.showDistance ?? true, p_gender_custom: o.custom ?? (o.gender === 'self-describe' ? 'Self described' : null) });
  if (o.place !== null) await rpc(u, 'save_place_id', { p_place_id: await placeId(o.place ?? 'lisbon') });
}

export async function completeProfile(u: TestUser, visibility: 'public' | 'followers' = 'public', discoverable = false) {
  await setIdentity(u);
  await rpc(u, 'save_basics', { p_display_name: u.name, p_date_of_birth: '1995-05-05', p_pronouns: '' });
  await rpc(u, 'save_about', { p_bio: `Bio of ${u.name}`, p_interests: [], p_prompts: [] });
  await rpc(u, 'save_preferences', { p_intention: 'long-term', p_interested_in: ['women'], p_age_min: 18, p_age_max: 60, p_max_distance: null });
  await rpc(u, 'save_privacy', { p_area_label: 'Lisbon', p_social_visibility: visibility, p_dating_discoverable: discoverable });
  await addProfilePhoto(u);
  await rpc(u, 'complete_onboarding');
}

export async function addProfilePhoto(u: TestUser): Promise<{ path: string; photoId: string }> {
  const path = `${u.id}/${rid()}.png`;
  must(await u.sb.storage.from('profile-photos').upload(path, PNG, { contentType: 'image/png', upsert: false }), 'upload photo');
  const photoId = await rpc<string>(u, 'register_photo', { p_path: path });
  return { path, photoId };
}

/** Creates a post (optionally with an image) and returns its id. */
export async function post(u: TestUser, caption: string, audience: 'public' | 'followers' = 'public', image = false): Promise<string> {
  const id = rid();
  let media: string | null = null;
  if (image) {
    media = `${u.id}/${id}/${rid()}.png`;
    must(await u.sb.storage.from('post-media').upload(media, PNG, { contentType: 'image/png', upsert: false }), 'upload post media');
  }
  await rpc(u, 'create_post', { p_post_id: id, p_caption: caption, p_audience: audience, p_media_path: media });
  return id;
}
export const mediaPathOf = async (postId: string) => (await admin.from('post_media').select('storage_path').eq('post_id', postId).maybeSingle()).data?.storage_path as string | undefined;

export interface FeedRow { post_id: string; author_id: string; caption: string; like_count: number; comment_count: number; liked_by_me: boolean; saved_by_me: boolean; page_cursor: string; media_path: string | null; author_photo_path: string | null; audience: string; is_mine: boolean }
export async function feed(u: TestUser, which: 'explore' | 'following', cursor: string | null = null, limit = 20): Promise<FeedRow[]> {
  return rpc<FeedRow[]>(u, 'feed_page', { p_feed: which, p_limit: limit, p_cursor: cursor });
}
export const ids = (rows: { post_id: string }[]) => rows.map((r) => r.post_id);

/** Raw PostgREST call with a user's JWT, for write attempts that bypass supabase-js conveniences. */
export async function rawRest(u: TestUser | null, method: string, path: string, body?: unknown) {
  const token = u ? (await u.sb.auth.getSession()).data.session!.access_token : ANON;
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method, headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json, text };
}

/* ------------------------------------------------------------------ Phase 4 helpers */

export const PLACES = {
  lisbon: { label: 'Lisbon', lat: 38.72, lng: -9.14 },
  almada: { label: 'Almada', lat: 38.68, lng: -9.16 },      // about 4.7 km from Lisbon
  sintra: { label: 'Sintra', lat: 38.80, lng: -9.38 },      // about 22 km
  setubal: { label: 'Setubal', lat: 38.52, lng: -8.89 },    // about 31 km
  porto: { label: 'Porto', lat: 41.15, lng: -8.61 },        // about 274 km
  madrid: { label: 'Madrid', lat: 40.42, lng: -3.70 },      // about 502 km
} as const;
export type PlaceKey = keyof typeof PLACES;

const placeIds = new Map<PlaceKey, number>();
/** The real GeoNames place id for a test place. Almada and Sintra are smaller than the seed threshold, so they are added once (local database only). */
export async function placeId(k: PlaceKey): Promise<number> {
  const hit = placeIds.get(k); if (hit) return hit;
  let id: number;
  if (k === 'almada' || k === 'sintra') {
    id = k === 'almada' ? 9000001 : 9000002; const pl = PLACES[k];
    must(await admin.from('places').upsert({ id, name: pl.label, region: 'Lisbon', country_code: 'PT', country: 'Portugal', lat: pl.lat, lng: pl.lng, population: 50000 }), 'seed test place');
  } else {
    const q = { lisbon: ['Lisbon', 'PT'], porto: ['Porto', 'PT'], madrid: ['Madrid', 'ES'], setubal: ['Set%bal', 'PT'] }[k];
    const rows = must(await admin.from('places').select('id,population').ilike('name', q[0]).eq('country_code', q[1]).order('population', { ascending: false }).limit(1));
    if (!rows[0]) throw new Error(`place ${k} not in the places seed`); id = rows[0].id as number;
  }
  placeIds.set(k, id); return id;
}

export interface DatingOpts {
  gender?: 'woman' | 'man' | 'non-binary' | 'self-describe'; interestedIn?: ('women' | 'men' | 'non-binary')[]; dob?: string; ageMin?: number; ageMax?: number;
  maxKm?: number | null; place?: PlaceKey | null; discoverable?: boolean; intention?: string; social?: 'public' | 'followers'; showDistance?: boolean; showGender?: boolean;
  interests?: string[]; complete?: boolean;
}
export const yearsAgo = (n: number) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - n); d.setUTCDate(d.getUTCDate() - 3); return d.toISOString().slice(0, 10); };

/** A fully set up dating profile. Defaults: a woman aged 30 in Lisbon who wants men and women of any age 18 to 99. */
export async function datingUser(label: string, o: DatingOpts = {}): Promise<TestUser> {
  const u = await createUser(label, { complete: false });
  await rpc(u, 'save_basics', { p_display_name: label, p_date_of_birth: o.dob ?? yearsAgo(30), p_pronouns: 'they/them' });
  await rpc(u, 'save_about', { p_bio: `Bio of ${label}`, p_interests: o.interests ?? ['coffee'], p_prompts: [{ question: 'A perfect Sunday', answer: `Sunday of ${label}` }] });
  await rpc(u, 'save_preferences', { p_intention: o.intention ?? 'long-term', p_interested_in: o.interestedIn ?? ['women', 'men', 'non-binary'], p_age_min: o.ageMin ?? 18, p_age_max: o.ageMax ?? 99, p_max_distance: o.maxKm ?? null });
  await rpc(u, 'save_privacy', { p_area_label: 'Somewhere', p_social_visibility: o.social ?? 'followers', p_dating_discoverable: o.discoverable ?? true });
  await setIdentity(u, { gender: o.gender, place: o.place, showGender: o.showGender, showDistance: o.showDistance });
  await addProfilePhoto(u);
  if (o.complete !== false) await rpc(u, 'complete_onboarding');
  return u;
}

/** Local-only: runs SQL inside the LOCAL database container (used to bend limits and age data in tests, never against anything else). */
export function localSql(sql: string): string {
  return execFileSync('docker', ['exec', 'supabase_db_lovoki', 'psql', '-U', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim();
}

export interface Card { user_id: string; display_name: string; age: number; gender: string | null; area_label: string; distance_bucket: string | null; intention: string; interests: string[]; photo_paths: string[]; page_cursor: string; bio: string }
export const discover = (u: TestUser, cursor: string | null = null, limit = 10) => rpc<Card[]>(u, 'discover_profiles', { p_limit: limit, p_cursor: cursor });
/** A person is "eligible" for the viewer exactly when dating_profile returns a card. */
export const eligible = async (v: TestUser, t: TestUser) => (await rpc<unknown[]>(v, 'dating_profile', { p_user: t.id })).length === 1;
export async function discoverAll(u: TestUser, limit = 10) {
  const rows: Card[] = []; let cursor: string | null = null;
  for (let i = 0; i < 30; i++) { const page = await discover(u, cursor, limit); rows.push(...page.slice(0, limit)); if (page.length <= limit) break; cursor = page[limit - 1]!.page_cursor; }
  return rows;
}
