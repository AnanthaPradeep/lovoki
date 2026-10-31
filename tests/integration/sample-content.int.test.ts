// INTEGRATION (Phase 4.5): the sample-content seeder, its safety gates, idempotency, removal, and the release guard.
// Runs the REAL scripts (scripts/seed-sample-content.mjs, scripts/assert-no-sample-data.mjs) against the LOCAL stack. Nothing is mocked.
// Sample accounts are removed at the start and the end, so other integration files never see them.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANON, URL_, admin, createUser, must, rpc } from './harness';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const SERVICE = process.env.LOVOKI_IT_SERVICE!;
const run = (script: string, args: string[], env: Record<string, string | undefined> = {}) => {
  const r = spawnSync('node', [`scripts/${script}`, ...args], { encoding: 'utf8', input: '', timeout: 240_000, env: { ...process.env, LOVOKI_SEED_API_URL: URL_, LOVOKI_SEED_SERVICE_KEY: SERVICE, ...env } });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};
const TABLES = ['profiles', 'posts', 'post_media', 'post_likes', 'post_saves', 'post_comments', 'follows', 'profile_photos', 'profile_prompts', 'profile_interests', 'profile_places'] as const;

async function sampleIds() {
  const ids = must(await admin.from('profiles').select('user_id').eq('is_sample', true), 'sample ids').map((r) => r.user_id as string);
  return ids;
}
async function snapshot() {
  const ids = await sampleIds(); const out: Record<string, number | string> = { users: ids.length };
  const col: Record<string, string> = { profiles: 'user_id', posts: 'author_id', post_media: 'user_id', post_likes: 'user_id', post_saves: 'user_id', post_comments: 'author_id', follows: 'follower_id', profile_photos: 'user_id', profile_prompts: 'user_id', profile_interests: 'user_id', profile_places: 'user_id' };
  const hash = createHash('sha1');
  for (const t of TABLES) {
    const rows = must(await admin.from(t).select('*').in(col[t]!, ids).limit(5000), t) as Record<string, unknown>[];
    out[t] = rows.length;
    // every value, except timestamps the database stamps on rows that a re-run is allowed to rewrite (profiles, photos...), so any changed value is caught
    const keepTs = ['posts', 'follows', 'post_comments', 'post_likes'].includes(t);
    const stable = rows.map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => keepTs || !/^(updated_at|created_at)$/.test(k)).sort(([a], [b]) => a.localeCompare(b))))).sort();
    hash.update(stable.join('|'));
  }
  out.hash = hash.digest('hex');
  let files = 0;
  for (const id of ids) for (const bucket of ['profile-photos', 'post-media']) {
    const top = (await admin.storage.from(bucket).list(id, { limit: 1000 })).data ?? [];
    for (const o of top) files += o.id === null ? ((await admin.storage.from(bucket).list(`${id}/${o.name}`, { limit: 1000 })).data ?? []).length : 1;
  }
  out.files = files;
  return out;
}

describe('sample content seeder (real script, local stack)', () => {
  beforeAll(() => { const r = run('seed-sample-content.mjs', ['--remove', '--yes']); expect(r.code, r.out).toBe(0); }, 240_000);
  afterAll(() => { run('seed-sample-content.mjs', ['--remove', '--yes']); }, 240_000);

  it('refuses everything it should refuse, and writes nothing when it does', async () => {
    const before = (await sampleIds()).length;
    const cases: [string, string[], Record<string, string | undefined>, number][] = [
      ['no confirmation: stdin is empty, so the question is not answered', [], {}, 3],
      ['a non-local URL without --hosted', ['--yes'], { LOVOKI_SEED_API_URL: 'https://example.supabase.co' }, 2],
      ['--hosted without --confirm-ref', ['--hosted', '--yes'], {}, 2],
      ['--hosted with a malformed ref', ['--hosted', '--confirm-ref', 'nope'], {}, 2],
      ['--hosted with a ref but no hosted env file', ['--hosted', '--confirm-ref', 'abcdefghijklmnopqrst'], {}, 2],
    ];
    for (const [why, args, env, code] of cases) { const r = run('seed-sample-content.mjs', args, env); expect(r.code, `${why}\n${r.out}`).toBe(code); }
    expect((await sampleIds()).length, 'a refused run creates nothing').toBe(before);
  });

  it('seeds a deterministic cast, and a second run changes nothing (idempotent)', async () => {
    const first = run('seed-sample-content.mjs', ['--yes', '--users', '12']); expect(first.code, first.out).toBe(0);
    const a = await snapshot();
    expect(a.users).toBe(12); expect(a.posts).toBeGreaterThanOrEqual(50); expect(a.profile_photos).toBeGreaterThanOrEqual(30); expect(a.post_media as number).toBeGreaterThan(40); expect(a.files as number).toBeGreaterThan(100);
    const second = run('seed-sample-content.mjs', ['--yes', '--users', '12']); expect(second.code, second.out).toBe(0);
    const b = await snapshot();
    expect(b, 'the second run must not add, remove or change anything').toEqual(a);
  }, 300_000);

  it('the cast has the promised shape: private and public, mixed genders, places, ages, photos, a spread of dates', async () => {
    const ids = await sampleIds();
    const prof = must(await admin.from('profiles').select('user_id,display_name,username,social_visibility,gender,dating_discoverable,avatar_blurhash,avatar_photo_id,is_sample,show_avatar_to_everyone').in('user_id', ids), 'profiles');
    expect(prof.filter((p) => p.social_visibility === 'followers').length).toBeGreaterThanOrEqual(2); expect(prof.filter((p) => p.social_visibility === 'public').length).toBeGreaterThanOrEqual(6);
    expect(new Set(prof.map((p) => p.gender)).size).toBeGreaterThanOrEqual(3); expect(prof.every((p) => p.avatar_blurhash && p.avatar_photo_id && p.username && p.is_sample)).toBe(true);
    expect(prof.filter((p) => p.social_visibility === 'followers').every((p) => p.show_avatar_to_everyone === false), 'private samples keep their picture blurred').toBe(true);
    const places = must(await admin.from('profile_places').select('place_id').in('user_id', ids), 'places'); expect(new Set(places.map((x) => x.place_id)).size).toBeGreaterThanOrEqual(6);
    const dobs = must(await admin.from('profiles_private').select('date_of_birth').in('user_id', ids), 'dobs').map((r) => new Date().getUTCFullYear() - Number(String(r.date_of_birth).slice(0, 4)));
    expect(Math.min(...dobs)).toBeGreaterThanOrEqual(20); expect(Math.max(...dobs)).toBeLessThanOrEqual(46);
    const posts = must(await admin.from('posts').select('created_at,caption,audience,author_id').in('author_id', ids).limit(2000), 'posts');
    const days = posts.map((p) => (Date.now() - Date.parse(p.created_at)) / 86_400_000); expect(Math.max(...days)).toBeGreaterThan(30); expect(Math.min(...days)).toBeLessThan(10); expect(Math.max(...days)).toBeLessThan(61);
    expect(posts.some((p) => p.caption.length > 300), 'a long caption exists').toBe(true); expect(posts.some((p) => /[\u{1F300}-\u{1FAFF}☀-➿]/u.test(p.caption)), 'an emoji caption exists').toBe(true);
    const priv = new Set(prof.filter((p) => p.social_visibility === 'followers').map((p) => p.user_id)); expect(posts.some((p) => priv.has(p.author_id)), 'private accounts have posts to hide').toBe(true);
    const media = must(await admin.from('post_media').select('thumb_path,blurhash,width,height,kind').in('user_id', ids).limit(2000), 'media');
    expect(media.every((m) => m.thumb_path && m.blurhash && m.width && m.height && m.kind === 'image')).toBe(true); expect(new Set(media.map((m) => `${m.width}x${m.height}`)).size, 'square and 4:5 pictures').toBeGreaterThanOrEqual(2);
  });

  it('counts are honest: the profile shows exactly what the rows say', async () => {
    const viewer = await createUser('smpviewer'); const ids = await sampleIds();
    const prof = must(await admin.from('profiles').select('user_id,username,social_visibility').in('user_id', ids), 'p').filter((p) => p.social_visibility === 'public')[0]!;
    const rows = (await rpc<{ follower_count: number; following_count: number; post_count: number }[]>(viewer, 'get_social_profile', { p_handle: prof.username }))[0]!;
    const acc = async (col: string) => (await admin.from('follows').select('*', { count: 'exact', head: true }).eq(col, prof.user_id).eq('status', 'accepted')).count;
    expect(rows.follower_count).toBe(await acc('followee_id')); expect(rows.following_count).toBe(await acc('follower_id'));
    const visible = must(await admin.from('posts').select('id').eq('author_id', prof.user_id).eq('audience', 'public'), 'posts').length; expect(rows.post_count).toBe(visible);
  });

  it('a real stranger cannot see a private sample\'s posts, a request to it stays pending, and nothing reaches it', async () => {
    const viewer = await createUser('smpstranger'); const ids = await sampleIds();
    const priv = must(await admin.from('profiles').select('user_id,username').in('user_id', ids).eq('social_visibility', 'followers'), 'priv')[0]!;
    const card = (await rpc<{ restricted: boolean; photo_path: string | null; avatar_blurhash: string | null; is_sample: boolean; is_private: boolean }[]>(viewer, 'get_social_profile', { p_handle: priv.username }))[0]!;
    expect(card).toMatchObject({ restricted: true, photo_path: null, is_sample: true, is_private: true }); expect(card.avatar_blurhash).toBeTruthy();
    expect(await rpc<unknown[]>(viewer, 'list_profile_posts', { p_handle: priv.username })).toEqual([]);
    const media = must(await admin.from('post_media').select('storage_path,thumb_path').eq('user_id', priv.user_id).limit(1), 'm')[0]!;
    for (const p of [media.storage_path, media.thumb_path]) expect((await viewer.sb.storage.from('post-media').createSignedUrl(p!, 60)).error, 'no signed URL for a stranger').not.toBeNull();
    expect(await rpc(viewer, 'follow_user', { p_user: priv.user_id })).toBe('pending');
    expect(must(await admin.from('notifications').select('id').eq('recipient_id', priv.user_id), 'n')).toEqual([]);
    const ex = await rpc<{ author_id: string }[]>(viewer, 'feed_page', { p_feed: 'explore', p_limit: 20 }); expect(ex.every((r) => r.author_id !== priv.user_id)).toBe(true);
  });

  it('samples cannot log in, cannot match and carry a permanent ban', async () => {
    const ids = await sampleIds(); const list = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.filter((u) => ids.includes(u.id));
    expect(list.length).toBe(ids.length); expect(list.every((u) => u.email!.endsWith('@sample.lovoki.invalid') && u.banned_until && Date.parse(u.banned_until) > Date.now() + 365 * 86_400_000)).toBe(true);
    const sb = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'smp-login' }, realtime: { transport: WebSocket as never } });
    for (const pw of ['password', 'correct-horse-battery-1', 'sample', '']) expect((await sb.auth.signInWithPassword({ email: list[0]!.email!, password: pw })).error).not.toBeNull();
    const d = await createUser('smpdater', { discoverable: true }); const target = ids[0]!;
    const r = await rpc<{ matched: boolean }[]>(d, 'like_profile', { p_target: target }); expect(r[0]!.matched).toBe(false);
    expect(must(await admin.from('dating_actions').select('*').eq('target_id', target), 'a')).toEqual([]); expect(must(await admin.from('matches').select('id').or(`user_a.eq.${target},user_b.eq.${target}`), 'm')).toEqual([]);
  });

  it('the release guard fails on production when samples exist, and passes when they do not', () => {
    const dev = run('assert-no-sample-data.mjs', []); expect(dev.code, dev.out).toBe(0); expect(dev.out).toMatch(/development target/);
    const prod = run('assert-no-sample-data.mjs', ['--expect', 'production']); expect(prod.code, prod.out).toBe(1); expect(prod.out).toMatch(/FAIL: sample data exists on a production target/);
    const unreachable = run('assert-no-sample-data.mjs', [], { LOVOKI_SEED_API_URL: 'http://127.0.0.1:1' }); expect(unreachable.code, 'a target it cannot check is a failure, not a pass').not.toBe(0);
    const nonLocal = run('assert-no-sample-data.mjs', [], { LOVOKI_SEED_API_URL: 'https://example.supabase.co' }); expect(nonLocal.code).toBe(2);
  });

  it('--remove deletes only sample accounts and every file they own, and leaves real users alone', async () => {
    const real = await createUser('smpreal'); const ids = await sampleIds(); expect(ids.length).toBeGreaterThan(0);
    const r = run('seed-sample-content.mjs', ['--remove', '--yes']); expect(r.code, r.out).toBe(0);
    expect(await sampleIds()).toEqual([]); expect((await admin.auth.admin.getUserById(real.id)).data.user?.id).toBe(real.id);
    for (const id of ids) for (const bucket of ['profile-photos', 'post-media']) expect(((await admin.storage.from(bucket).list(id)).data ?? []).length, `${bucket}/${id} is empty`).toBe(0);
    for (const t of ['posts', 'post_comments'] as const) expect((await admin.from(t).select('*', { count: 'exact', head: true }).eq('is_sample', true)).count).toBe(0);
    const prod = run('assert-no-sample-data.mjs', ['--expect', 'production']); expect(prod.code, prod.out).toBe(0);
  }, 240_000);
});
