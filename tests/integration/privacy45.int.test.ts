// INTEGRATION (Phase 4.5): who sees what on a public or private account, for every relationship, on every surface.
// Real GoTrue + PostgREST + Postgres RLS + Storage on the LOCAL stack. Nothing here is mocked.
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { beforeAll, describe, expect, it } from 'vitest';
import { ANON, PNG, URL_, addProfilePhoto, admin, createUser, localSql, must, rawRest, rid, rpc, rpcFails, type TestUser } from './harness';

const BH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';
interface PostRow { post_id: string; author_id: string; media_path: string | null; thumb_path: string | null; media_kind: string | null; media_width: number | null; media_blurhash: string | null; audience: string; page_cursor: string; author_photo_path: string | null; author_blurhash: string | null; author_private: boolean; is_sample: boolean }
interface ProfRow { user_id: string; username: string; display_name: string; bio: string; photo_path: string | null; avatar_blurhash: string | null; restricted: boolean; is_private: boolean; relationship: string; follower_count: number | null; following_count: number | null; post_count: number | null; age: number | null; area_label: string | null; is_sample: boolean }
interface CardRow { user_id: string; username: string; display_name: string; photo_path: string | null; avatar_blurhash: string | null; is_private: boolean; is_sample: boolean; follow_status: string | null }

const handleOf = async (u: TestUser) => (await admin.from('profiles').select('username').eq('user_id', u.id).single()).data!.username as string;
const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false, storageKey: `anon-${rid()}` }, realtime: { transport: WebSocket as never } });
const canSign = async (v: { sb: ReturnType<typeof anonClient> }, bucket: string, path: string) => !(await v.sb.storage.from(bucket).createSignedUrl(path, 60)).error;

interface Made { id: string; main: string; thumb: string }
async function mediaPost(u: TestUser, caption: string, audience: 'public' | 'followers'): Promise<Made> {
  const id = rid(); const main = `${u.id}/${id}/${rid()}.png`; const thumb = `${u.id}/${id}/${rid()}.png`;
  must(await u.sb.storage.from('post-media').upload(main, PNG, { contentType: 'image/png', upsert: false }), 'upload original');
  must(await u.sb.storage.from('post-media').upload(thumb, PNG, { contentType: 'image/png', upsert: false }), 'upload thumb');
  await rpc(u, 'create_post', { p_post_id: id, p_caption: caption, p_audience: audience, p_media_path: main, p_thumb_path: thumb, p_width: 1080, p_height: 1350, p_blurhash: BH });
  return { id, main, thumb };
}
async function withAvatar(u: TestUser) {
  const { path, photoId } = await addProfilePhoto(u);
  await rpc(u, 'save_avatar', { p_photo_id: photoId, p_crop: { x: 0.5, y: 0.5, zoom: 1 }, p_blurhash: BH });
  return path;
}
const grid = async (v: TestUser, h: string) => (await rpc<PostRow[]>(v, 'list_profile_posts', { p_handle: h, p_limit: 20 })).slice(0, 20);
const profile = async (v: TestUser, h: string) => (await rpc<ProfRow[]>(v, 'get_social_profile', { p_handle: h }))[0] ?? null;

describe('Phase 4.5 privacy matrix: viewer relationship x account type x surface', () => {
  let Pb: TestUser, Pv: TestUser; // public and private owner
  let follower: TestUser, pending: TestUser, stranger: TestUser, blockedByOwner: TestUser, blockerOfOwner: TestUser;
  let hb: string, hv: string, avB: string, avV: string;
  const M: Record<'b' | 'v', { pub: Made; fol: Made }> = {} as never;

  beforeAll(async () => {
    [Pb, Pv, follower, pending, stranger, blockedByOwner, blockerOfOwner] = await Promise.all([
      createUser('pb'), createUser('pv', { visibility: 'followers' }), createUser('follower'), createUser('pending'), createUser('stranger'),
      createUser('blkdbyown'), createUser('blkrofown')]);
    hb = await handleOf(Pb); hv = await handleOf(Pv);
    [avB, avV] = await Promise.all([withAvatar(Pb), withAvatar(Pv)]);
    M.b = { pub: await mediaPost(Pb, 'public post, public account', 'public'), fol: await mediaPost(Pb, 'followers post, public account', 'followers') };
    M.v = { pub: await mediaPost(Pv, 'public post, private account', 'public'), fol: await mediaPost(Pv, 'followers post, private account', 'followers') };
    await rpc(follower, 'follow_user', { p_user: Pb.id });
    await rpc(follower, 'follow_user', { p_user: Pv.id }); await rpc(Pv, 'respond_follow_request', { p_follower: follower.id, p_accept: true });
    await rpc(pending, 'follow_user', { p_user: Pv.id });
    for (const o of [Pb, Pv]) await rpc(o, 'block_user', { p_user: blockedByOwner.id });
    for (const o of [Pb, Pv]) await rpc(blockerOfOwner, 'block_user', { p_user: o.id });
  });

  describe('a PRIVATE account', () => {
    it('self sees everything', async () => {
      const p = (await profile(Pv, hv))!;
      expect(p).toMatchObject({ relationship: 'self', restricted: false, post_count: 2 }); expect(p.photo_path).toBe(avV);
      expect((await grid(Pv, hv)).map((r) => r.post_id).sort()).toEqual([M.v.pub.id, M.v.fol.id].sort());
    });
    it('an accepted follower sees profile, avatar, grid with thumbnails, originals, both lists', async () => {
      const p = (await profile(follower, hv))!;
      expect(p).toMatchObject({ relationship: 'follower', restricted: false, is_private: true, post_count: 2, follower_count: 1 }); expect(p.photo_path).toBe(avV);
      const g = await grid(follower, hv); expect(g).toHaveLength(2);
      for (const r of g) { expect(r.thumb_path).toBeTruthy(); expect(r.media_width).toBe(1080); expect(r.media_blurhash).toBe(BH); }
      for (const m of [M.v.pub, M.v.fol]) { expect(await canSign(follower, 'post-media', m.thumb)).toBe(true); expect(await canSign(follower, 'post-media', m.main)).toBe(true); }
      expect(await canSign(follower, 'profile-photos', avV)).toBe(true);
      expect((await rpc<CardRow[]>(follower, 'list_followers', { p_handle: hv })).map((c) => c.user_id)).toContain(follower.id);
    });
    for (const [label, who] of [['a pending requester', () => pending], ['a stranger', () => stranger]] as const) {
      it(`${label} sees only handle, name, bio, a blurred avatar placeholder and counts (D3): nothing else`, async () => {
        const v = who(); const p = (await profile(v, hv))!;
        expect(p).toMatchObject({ username: hv, display_name: 'pv', bio: 'Bio of pv', restricted: true, is_private: true, avatar_blurhash: BH, photo_path: null, age: null, area_label: null, post_count: 2, follower_count: 1, following_count: 0 });
        expect(p.relationship).toBe(v === pending ? 'pending' : 'stranger');
        expect(await grid(v, hv), 'no grid').toEqual([]);
        for (const m of [M.v.pub, M.v.fol]) {
          expect(await rpc<unknown[]>(v, 'post_page', { p_post: m.id }), 'post page').toEqual([]);
          expect(await canSign(v, 'post-media', m.thumb), 'thumbnail object').toBe(false);
          expect(await canSign(v, 'post-media', m.main), 'original object').toBe(false);
          expect((await v.sb.storage.from('post-media').download(m.main)).error, 'direct download').not.toBeNull();
        }
        expect(await canSign(v, 'profile-photos', avV), 'the real avatar file is never served').toBe(false);
        expect(await rpc<unknown[]>(v, 'list_followers', { p_handle: hv }), 'lists are gated').toEqual([]);
        expect(await rpc<unknown[]>(v, 'list_following', { p_handle: hv })).toEqual([]);
        const ex = await rpc<PostRow[]>(v, 'feed_page', { p_feed: 'explore', p_limit: 20 });
        expect(ex.filter((r) => r.author_id === Pv.id), 'private posts are not in Explore').toEqual([]);
        expect(JSON.stringify(ex)).not.toContain(avV);
        await rpcFails(v, 'like_post', { p_post: M.v.pub.id }, 'LOVOKI_NOT_FOUND');
        await rpcFails(v, 'add_comment', { p_post: M.v.pub.id, p_body: 'hi' }, 'LOVOKI_NOT_FOUND');
        await rpcFails(v, 'report_content', { p_type: 'post', p_target: M.v.fol.id, p_reason: 'spam', p_details: '' }, 'LOVOKI_NOT_FOUND');
      });
    }
    it('blocked in either direction: not even the card', async () => {
      for (const v of [blockedByOwner, blockerOfOwner]) {
        expect(await profile(v, hv)).toBeNull(); expect(await grid(v, hv)).toEqual([]);
        expect(await canSign(v, 'post-media', M.v.pub.thumb)).toBe(false); expect(await canSign(v, 'profile-photos', avV)).toBe(false);
        expect((await rpc<CardRow[]>(v, 'search_profiles', { p_q: hv.slice(0, 6) })).map((c) => c.user_id)).not.toContain(Pv.id);
      }
    });
  });

  describe('a PUBLIC account', () => {
    it('self and an accepted follower see everything', async () => {
      for (const v of [Pb, follower]) { expect(await grid(v, hb)).toHaveLength(2); expect(await canSign(v, 'post-media', M.b.fol.thumb)).toBe(true); }
      expect((await profile(follower, hb))!.relationship).toBe('follower');
    });
    it('a stranger sees the profile, the avatar, public-audience posts and their thumbnails, but not a followers-only post', async () => {
      const p = (await profile(stranger, hb))!;
      expect(p).toMatchObject({ restricted: false, is_private: false, relationship: 'stranger', post_count: 1 }); expect(p.photo_path).toBe(avB);
      expect((await grid(stranger, hb)).map((r) => r.post_id)).toEqual([M.b.pub.id]);
      expect(await canSign(stranger, 'post-media', M.b.pub.thumb)).toBe(true); expect(await canSign(stranger, 'post-media', M.b.pub.main)).toBe(true);
      expect(await canSign(stranger, 'post-media', M.b.fol.thumb)).toBe(false); expect(await canSign(stranger, 'post-media', M.b.fol.main)).toBe(false);
      expect(await rpc<unknown[]>(stranger, 'post_page', { p_post: M.b.fol.id })).toEqual([]);
      expect(await canSign(stranger, 'profile-photos', avB)).toBe(true);
      expect((await rpc<CardRow[]>(stranger, 'list_followers', { p_handle: hb })).map((c) => c.user_id)).toContain(follower.id);
    });
    it('blocked in either direction: nothing', async () => {
      for (const v of [blockedByOwner, blockerOfOwner]) { expect(await profile(v, hb)).toBeNull(); expect(await grid(v, hb)).toEqual([]); expect(await canSign(v, 'post-media', M.b.pub.thumb)).toBe(false); }
    });
  });

  describe('logged out and direct database access', () => {
    it('anonymous callers get nothing from any function and no table is readable', async () => {
      const a = anonClient();
      for (const [fn, args] of [['get_social_profile', { p_handle: hb }], ['list_profile_posts', { p_handle: hb }], ['list_followers', { p_handle: hb }], ['search_profiles', { p_q: 'pb' }],
        ['feed_page', { p_feed: 'explore' }], ['post_page', { p_post: M.b.pub.id }], ['suggested_people', {}], ['sample_flags', { p_ids: [] }]] as const) {
        const r = await a.rpc(fn, args as never); expect(r.error, `${fn} must be denied to anon`).not.toBeNull();
      }
      for (const t of ['profiles', 'posts', 'post_media', 'follows', 'app_config', 'post_comments', 'post_likes', 'profile_photos']) {
        const r = await a.from(t).select('*').limit(1); expect(r.error?.code ?? 'none', `${t} as anon`).not.toBe('none'); expect(r.data ?? []).toEqual([]);
      }
      expect(await canSign({ sb: a }, 'post-media', M.b.pub.thumb)).toBe(false);
      expect(await canSign({ sb: a }, 'profile-photos', avB)).toBe(false);
    });
    it('a signed-in user cannot read or write the tables directly, including the new columns', async () => {
      for (const t of ['posts', 'post_media', 'post_comments', 'post_likes', 'app_config']) {
        const r = await rawRest(stranger, 'GET', `${t}?select=*&limit=5`); expect([401, 403, 404]).toContain(r.status); expect(Array.isArray(r.json) ? r.json : []).toHaveLength(0);
      }
      const prof = await rawRest(stranger, 'GET', `profiles?select=is_sample,avatar_blurhash,show_avatar_to_everyone&user_id=eq.${Pv.id}`);
      expect(Array.isArray(prof.json) ? prof.json : [], 'profiles has no client read path').toHaveLength(0);
      for (const [method, path, body] of [['PATCH', `profiles?user_id=eq.${stranger.id}`, { is_sample: true }], ['PATCH', `profiles?user_id=eq.${stranger.id}`, { show_avatar_to_everyone: true }],
        ['POST', 'app_config', { environment: 'production' }], ['PATCH', 'app_config?id=eq.true', { environment: 'production' }], ['PATCH', `post_media?post_id=eq.${M.b.pub.id}`, { kind: 'video' }]] as const) {
        const r = await rawRest(stranger, method, path, body); expect(r.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
      }
      expect(localSql('select environment from public.app_config')).toBe('development');
    });
  });

  describe('every payload is scanned for keys that must never appear', () => {
    const FORBIDDEN = /date_of_birth|\bdob\b|email|\blat\b|\blng\b|latitude|longitude|dating_discoverable|dating_prefer|interested_in|filter_|password|secret|service_role|religion_opt|storage_path|discoverable/i;
    const keys = (v: unknown, out = new Set<string>()): Set<string> => { if (Array.isArray(v)) v.forEach((x) => keys(x, out)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keys(x, out); } return out; };
    it('profile, grid, post page, feeds, search, people and suggestions expose no private key or email', async () => {
      const payloads: unknown[] = [];
      for (const v of [stranger, follower, Pv]) {
        for (const h of [hb, hv]) { payloads.push(await rpc(v, 'get_social_profile', { p_handle: h }), await rpc(v, 'list_profile_posts', { p_handle: h }), await rpc(v, 'list_followers', { p_handle: h }), await rpc(v, 'list_following', { p_handle: h }), await rpc(v, 'search_profiles', { p_q: h.slice(0, 5) })); }
        payloads.push(await rpc(v, 'feed_page', { p_feed: 'explore' }), await rpc(v, 'feed_page', { p_feed: 'following' }), await rpc(v, 'suggested_people', {}), await rpc(v, 'post_page', { p_post: M.b.pub.id }));
      }
      const bad = [...keys(payloads)].filter((k) => FORBIDDEN.test(k)); expect(bad).toEqual([]);
      const text = JSON.stringify(payloads); expect(text).not.toMatch(/@lovoki-it\.test/); expect(text).not.toMatch(/"1995-05-05"/);
    });
  });
});

describe('Phase 4.5 avatar, counts, search and lists on a private account', () => {
  let O: TestUser, S: TestUser, F: TestUser, h: string, av: string, other: string;
  beforeAll(async () => {
    [O, S, F] = await Promise.all([createUser('privO', { visibility: 'followers' }), createUser('privS'), createUser('privF')]);
    h = await handleOf(O); av = await withAvatar(O); other = (await addProfilePhoto(O)).path;
    await rpc(F, 'follow_user', { p_user: O.id }); await rpc(O, 'respond_follow_request', { p_follower: F.id, p_accept: true });
  });

  it('"Show my profile picture to everyone" exposes ONLY the avatar file, and turning it off hides it again', async () => {
    expect(await canSign(S, 'profile-photos', av)).toBe(false);
    await rpc(O, 'save_social_settings', { p_allow_comments: 'everyone', p_show_follower_counts: true, p_searchable: true, p_show_avatar_to_everyone: true });
    expect((await profile(S, h))!.photo_path).toBe(av); expect(await canSign(S, 'profile-photos', av)).toBe(true);
    expect(await canSign(S, 'profile-photos', other), 'other photos stay private').toBe(false);
    await rpc(O, 'save_social_settings', { p_allow_comments: 'everyone', p_show_follower_counts: true, p_searchable: true, p_show_avatar_to_everyone: false });
    expect((await profile(S, h))!.photo_path).toBeNull(); expect(await canSign(S, 'profile-photos', av)).toBe(false);
  });
  it('hiding counts hides counts and the lists from everyone except the owner (followers too)', async () => {
    await rpc(O, 'save_social_settings', { p_allow_comments: 'everyone', p_show_follower_counts: false, p_searchable: true, p_show_avatar_to_everyone: false });
    for (const v of [S, F]) expect(await profile(v, h)).toMatchObject({ follower_count: null, following_count: null, post_count: null });
    expect(await rpc<unknown[]>(F, 'list_followers', { p_handle: h })).toEqual([]);
    expect(await profile(O, h)).toMatchObject({ follower_count: 1, following_count: 0 });
    expect((await rpc<CardRow[]>(O, 'list_followers', { p_handle: h })).map((c) => c.user_id)).toEqual([F.id]);
    await rpc(O, 'save_social_settings', { p_allow_comments: 'everyone', p_show_follower_counts: true, p_searchable: true, p_show_avatar_to_everyone: false });
  });
  it('search: prefix on handle and name, 2+ characters, private shown as a limited card, wildcards are literal, opt-out honoured', async () => {
    const find = async (v: TestUser, q: string) => rpc<CardRow[]>(v, 'search_profiles', { p_q: q });
    const hit = (await find(S, h.slice(0, 7))).find((c) => c.user_id === O.id)!;
    expect(hit).toMatchObject({ username: h, display_name: 'privO', is_private: true, photo_path: null, avatar_blurhash: BH });
    expect(Object.keys(hit).sort()).toEqual(['avatar_blurhash', 'avatar_crop', 'display_name', 'follow_status', 'is_private', 'is_sample', 'page_cursor', 'photo_path', 'user_id', 'username']);
    expect((await find(S, 'privo')).map((c) => c.user_id), 'display name prefix').toContain(O.id);
    expect(await find(S, 'p'), 'one character returns nothing').toEqual([]);
    expect(await find(S, '%%'), 'a wildcard matches nothing').toEqual([]); expect(await find(S, '__')).toEqual([]);
    expect((await find(O, h.slice(0, 7))).map((c) => c.user_id), 'never yourself').not.toContain(O.id);
    await rpc(O, 'save_social_settings', { p_allow_comments: 'everyone', p_show_follower_counts: true, p_searchable: false, p_show_avatar_to_everyone: false });
    expect((await find(S, h.slice(0, 7))).map((c) => c.user_id)).not.toContain(O.id);
    await rpc(O, 'save_social_settings', { p_allow_comments: 'everyone', p_show_follower_counts: true, p_searchable: true, p_show_avatar_to_everyone: false });
  });
  it('search is rate limited per user', async () => {
    const R = await createUser('rl'); let limited = false;
    for (let i = 0; i < 45 && !limited; i++) { const r = await R.sb.rpc('search_profiles', { p_q: 'zz' }); if (r.error?.message.includes('LOVOKI_RATE_LIMITED')) limited = true; }
    expect(limited).toBe(true);
  });
  it('suggested people: public, finished, unblocked profiles only; never a private account or someone already followed', async () => {
    const N = await createUser('newbie'); const s = await rpc<CardRow[]>(N, 'suggested_people', {});
    expect(s.map((c) => c.user_id)).not.toContain(O.id); expect(s.every((c) => !c.is_private)).toBe(true);
    await rpc(N, 'follow_user', { p_user: S.id }); expect((await rpc<CardRow[]>(N, 'suggested_people', {})).map((c) => c.user_id)).not.toContain(S.id);
  });
});

describe('Phase 4.5 transitions', () => {
  it('public -> private: followers stay, pending stays pending, strangers lose everything at once, old likes and comments are retained', async () => {
    const O = await createUser('trO'); const f = await createUser('trF'); const s = await createUser('trS'); const p = await createUser('trP');
    const h = await handleOf(O); const m = await mediaPost(O, 'was public', 'public'); await withAvatar(O);
    await rpc(f, 'follow_user', { p_user: O.id });
    await rpc(s, 'like_post', { p_post: m.id }); await rpc(s, 'add_comment', { p_post: m.id, p_body: 'left while public' }); await rpc(f, 'like_post', { p_post: m.id });
    expect(await grid(s, h)).toHaveLength(1); expect(await canSign(s, 'post-media', m.thumb)).toBe(true);
    await rpc(O, 'set_account_private', { p_private: true });
    expect(await rpc<unknown[]>(s, 'post_page', { p_post: m.id })).toEqual([]); expect(await grid(s, h)).toEqual([]);
    expect(await canSign(s, 'post-media', m.thumb)).toBe(false); expect(await canSign(s, 'post-media', m.main)).toBe(false);
    expect((await rpc<PostRow[]>(s, 'feed_page', { p_feed: 'explore' })).map((r) => r.post_id)).not.toContain(m.id);
    expect((await profile(s, h))).toMatchObject({ restricted: true, photo_path: null });
    expect((await grid(f, h)).map((r) => r.post_id)).toEqual([m.id]); expect(await canSign(f, 'post-media', m.thumb)).toBe(true);
    const fp = (await rpc<{ like_count: number; comment_count: number }[]>(f, 'post_page', { p_post: m.id }))[0]!;
    expect(fp, 'likes and comments left while public are retained for people who can still see the post').toMatchObject({ like_count: 2, comment_count: 1 });
    expect(await rpc(p, 'follow_user', { p_user: O.id })).toBe('pending');
    // private -> public: nobody is approved on the owner's behalf
    await rpc(O, 'set_account_private', { p_private: false });
    expect((await admin.from('follows').select('status').eq('follower_id', p.id).eq('followee_id', O.id).single()).data!.status).toBe('pending');
    expect((await profile(p, h))).toMatchObject({ relationship: 'pending', restricted: false });
    expect(await grid(s, h)).toHaveLength(1);
  });
  it('removing a follower ends access at once; a signed URL issued before stays valid only until its TTL (documented residual risk)', async () => {
    const O = await createUser('rmO', { visibility: 'followers' }); const f = await createUser('rmF'); const h = await handleOf(O);
    await rpc(f, 'follow_user', { p_user: O.id }); await rpc(O, 'respond_follow_request', { p_follower: f.id, p_accept: true });
    const m = await mediaPost(O, 'secret', 'followers');
    const issued = must(await f.sb.storage.from('post-media').createSignedUrl(m.thumb, 3), 'sign').signedUrl;
    expect((await fetch(issued)).status, 'follower can load while following').toBe(200);
    await rpc(O, 'remove_follower', { p_follower: f.id });
    expect(await grid(f, h)).toEqual([]); expect(await canSign(f, 'post-media', m.thumb), 'a NEW url is refused immediately').toBe(false);
    expect((await fetch(issued)).status, 'RESIDUAL RISK: the already-issued URL still works until it expires').toBe(200);
    await new Promise((r) => setTimeout(r, 4500));
    expect((await fetch(issued)).status, 'after the TTL it is dead').toBeGreaterThanOrEqual(400);
  });
  it('blocking ends access, removes follows both ways and the card disappears', async () => {
    const O = await createUser('bkO', { visibility: 'followers' }); const f = await createUser('bkF'); const h = await handleOf(O);
    await rpc(f, 'follow_user', { p_user: O.id }); await rpc(O, 'respond_follow_request', { p_follower: f.id, p_accept: true });
    const m = await mediaPost(O, 'x', 'public');
    await rpc(O, 'block_user', { p_user: f.id });
    expect(await profile(f, h)).toBeNull(); expect(await canSign(f, 'post-media', m.thumb)).toBe(false);
    expect((await admin.from('follows').select('*').eq('followee_id', O.id)).data).toEqual([]);
  });
  it('a media row of kind "video" gets exactly the same protection (policies are media-kind agnostic)', async () => {
    const O = await createUser('vdO', { visibility: 'followers' }); const f = await createUser('vdF'); const s = await createUser('vdS'); const h = await handleOf(O);
    await rpc(f, 'follow_user', { p_user: O.id }); await rpc(O, 'respond_follow_request', { p_follower: f.id, p_accept: true });
    const m = await mediaPost(O, 'a clip', 'followers');
    must(await admin.from('post_media').update({ kind: 'video', content_type: 'video/mp4' }).eq('post_id', m.id), 'turn the row into a video');
    expect((await grid(f, h))[0]).toMatchObject({ media_kind: 'video' }); expect(await canSign(f, 'post-media', m.thumb)).toBe(true); expect(await canSign(f, 'post-media', m.main)).toBe(true);
    expect(await grid(s, h)).toEqual([]); expect(await canSign(s, 'post-media', m.thumb)).toBe(false); expect(await canSign(s, 'post-media', m.main)).toBe(false);
    expect(await rpc<unknown[]>(s, 'post_page', { p_post: m.id })).toEqual([]);
    await rpc(O, 'set_post_audience', { p_post: m.id, p_audience: 'public' }); await rpc(O, 'set_account_private', { p_private: false });
    expect(await canSign(s, 'post-media', m.thumb), 'public video thumbnails are readable').toBe(true);
    expect((await rpc<PostRow[]>(s, 'feed_page', { p_feed: 'explore', p_limit: 20 })).find((r) => r.post_id === m.id)?.media_kind).toBe('video');
  });
  it('create_post validates the media fields and rejects a thumbnail that is not the caller\'s own object', async () => {
    const u = await createUser('cpv'); const id = rid(); const main = `${u.id}/${id}/${rid()}.png`;
    must(await u.sb.storage.from('post-media').upload(main, PNG, { contentType: 'image/png' }));
    for (const bad of [{ p_width: 0, p_height: 5 }, { p_width: 9000, p_height: 5 }, { p_width: 5 }, { p_blurhash: 'no spaces allowed!' }, { p_thumb_path: `${rid()}/${id}/${rid()}.png` }, { p_thumb_path: main }]) {
      const r = await u.sb.rpc('create_post', { p_post_id: id, p_caption: 'x', p_audience: 'public', p_media_path: main, ...bad });
      expect(r.error?.message, JSON.stringify(bad)).toMatch(/LOVOKI_INVALID/);
    }
    expect((await admin.from('posts').select('id').eq('id', id)).data, 'a rejected create leaves no post behind').toEqual([]);
    const r = await u.sb.rpc('create_post', { p_post_id: rid(), p_caption: 'x', p_audience: 'public', p_width: 5, p_height: 5 });
    expect(r.error?.message).toMatch(/LOVOKI_INVALID/);
  });
});

describe('Phase 4.5 sample content guards', () => {
  let S: TestUser, V: TestUser, P: TestUser, sp: Made;
  beforeAll(async () => {
    [S, V, P] = await Promise.all([createUser('smp', { discoverable: true }), createUser('viewer'), createUser('smpPriv', { visibility: 'followers' })]);
    for (const u of [S, P]) must(await admin.from('profiles').update({ is_sample: true }).eq('user_id', u.id), 'flag sample');
    sp = await mediaPost(S, 'a sample post', 'public');
  });
  it('profiles, posts and comments carry the flag; a client cannot set it', async () => {
    expect((await profile(V, await handleOf(S)))!.is_sample).toBe(true);
    expect((await rpc<PostRow[]>(V, 'post_page', { p_post: sp.id }))[0]!.is_sample).toBe(true);
    expect((await admin.from('posts').select('is_sample').eq('id', sp.id).single()).data!.is_sample).toBe(true);
    const c = await rpc<string>(V, 'add_comment', { p_post: sp.id, p_body: 'hello' });
    expect((await admin.from('post_comments').select('is_sample').eq('id', c).single()).data!.is_sample, 'a comment BY a real user is not sample').toBe(false);
    expect((await rpc<{ user_id: string; is_sample: boolean }[]>(V, 'sample_flags', { p_ids: [S.id, V.id] }))).toEqual([{ user_id: S.id, is_sample: true }]);
  });
  it('following a public sample is instant, a private sample stays pending forever; no notification reaches a sample', async () => {
    expect(await rpc(V, 'follow_user', { p_user: S.id })).toBe('accepted'); expect(await rpc(V, 'follow_user', { p_user: P.id })).toBe('pending');
    await rpc(V, 'like_post', { p_post: sp.id });
    expect((await admin.from('notifications').select('id').in('recipient_id', [S.id, P.id])).data, 'nothing is delivered to a sample account').toEqual([]);
  });
  it('a dating like on a sample stores nothing and never matches', async () => {
    const D = await createUser('datr', { discoverable: true });
    const r = await rpc<{ matched: boolean; match_id: string | null }[]>(D, 'like_profile', { p_target: S.id });
    expect(r[0]).toMatchObject({ matched: false, match_id: null });
    expect((await admin.from('dating_actions').select('*').eq('target_id', S.id)).data).toEqual([]);
    expect((await admin.from('matches').select('id').or(`user_a.eq.${S.id},user_b.eq.${S.id}`)).data).toEqual([]);
  });
  it('reports on a sample are rejected with a clear code, but only after the visibility check', async () => {
    await rpcFails(V, 'report_content', { p_type: 'post', p_target: sp.id, p_reason: 'spam', p_details: '' }, 'LOVOKI_SAMPLE_TARGET');
    await rpcFails(V, 'report_content', { p_type: 'profile', p_target: S.id, p_reason: 'spam', p_details: '' }, 'LOVOKI_SAMPLE_TARGET');
    const hidden = await mediaPost(P, 'hidden sample post', 'followers');
    await rpcFails(V, 'report_content', { p_type: 'post', p_target: hidden.id, p_reason: 'spam', p_details: '' }, 'LOVOKI_NOT_FOUND');
  });
  it('production refuses sample rows and app_config is locked (real SQL, rolled back)', async () => {
    const sql = (body: string) => { try { return localSql(`begin; ${body}; rollback;`); } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
    expect(sql(`update public.app_config set environment = 'production'`)).toMatch(/LOVOKI_CONFIG_LOCKED/);
    expect(sql(`set local lovoki.allow_config_change = 'on'; update public.app_config set environment = 'production'; update public.profiles set is_sample = true where user_id = '${V.id}'`)).toMatch(/LOVOKI_SAMPLE_FORBIDDEN/);
    expect(sql(`set local lovoki.allow_config_change = 'on'; update public.app_config set environment = 'production'; insert into public.post_comments (post_id, author_id, body) select '${sp.id}', '${S.id}', 'x'`)).toMatch(/LOVOKI_SAMPLE_FORBIDDEN/);
    expect(localSql('select environment from public.app_config')).toBe('development');
  });
});
