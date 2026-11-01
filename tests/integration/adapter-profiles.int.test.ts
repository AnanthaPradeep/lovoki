// INTEGRATION (Phase 4.5): the REAL SupabaseSocialApi, SupabaseAccountApi and SupabaseDatingApi (apps/web/src/data) against the local stack:
// thumbnails and blurhash on posts, the handle-based profile/grid/lists/search/suggestions, the 120 s signed-URL lifetime, typed errors, settings.
import { beforeAll, describe, expect, it } from 'vitest';
import { AccountFailure, SIGNED_URL_TTL_S, SocialFailure } from '@lovoki/core';
import { SupabaseAccountApi } from '../../apps/web/src/data/SupabaseAccountApi';
import { SupabaseDatingApi } from '../../apps/web/src/data/SupabaseDatingApi';
import { SupabaseSocialApi } from '../../apps/web/src/data/SupabaseSocialApi';
import { JPEG, PNG, addProfilePhoto, admin, createUser, datingUser, must, rid, type TestUser } from './harness';

const BH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';
const handleOf = async (u: TestUser) => (await admin.from('profiles').select('username').eq('user_id', u.id).single()).data!.username as string;
const social = (u: TestUser) => new SupabaseSocialApi(u.sb, u.id);
const png = () => new Blob([PNG], { type: 'image/png' });
const jpg = () => new Blob([JPEG], { type: 'image/jpeg' });
const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof SocialFailure || e instanceof AccountFailure ? e.code : `other:${String(e)}`; } };
const jwtExp = (url: string) => { const t = new URL(url).searchParams.get('token')!; const b = JSON.parse(Buffer.from(t.split('.')[1]!, 'base64url').toString()) as { exp: number; iat?: number }; return b; };

describe('SupabaseSocialApi: posts with thumbnails, handle APIs, lists, search', () => {
  let O: TestUser, F: TestUser, S: TestUser, ho: string; let oApi: SupabaseSocialApi, fApi: SupabaseSocialApi, sApi: SupabaseSocialApi;
  beforeAll(async () => {
    [O, F, S] = await Promise.all([createUser('apOwner', { visibility: 'followers' }), createUser('apFollower'), createUser('apStranger')]);
    ho = await handleOf(O); oApi = social(O); fApi = social(F); sApi = social(S);
    await fApi.follow(O.id); await oApi.respondToRequest(F.id, true);
  });

  it('createPost uploads the original AND the thumbnail, stores size and blurhash, and the grid returns the thumbnail path', async () => {
    const id = rid(); await oApi.createPost({ id, caption: 'with a thumbnail', audience: 'public', image: png(), thumb: jpg(), size: { width: 1080, height: 1350 }, blurhash: BH });
    const post = (await oApi.post(id))!;
    expect(post.media).toMatchObject({ kind: 'image', width: 1080, height: 1350, blurhash: BH, contentType: 'image/png' }); expect(post.media!.thumbPath).toBeTruthy(); expect(post.media!.thumbPath).not.toBe(post.media!.path);
    const grid = (await fApi.profilePosts(ho)).items; expect(grid.map((p) => p.id)).toContain(id);
    const urls = await fApi.mediaUrls([{ bucket: 'post-media', path: post.media!.thumbPath! }, { bucket: 'post-media', path: post.media!.path }]); expect(urls.size).toBe(2);
    expect((await sApi.profilePosts(ho)).items, 'a stranger of a private account gets an empty grid').toEqual([]); expect(await sApi.post(id)).toBeNull();
    expect((await sApi.mediaUrls([{ bucket: 'post-media', path: post.media!.thumbPath! }])).size, 'and no URL for the thumbnail').toBe(0);
  });

  it('a failed create leaves no orphan objects: both files are removed', async () => {
    const id = rid();
    expect(await code(oApi.createPost({ id, caption: '', audience: 'public', image: png(), thumb: jpg(), size: { width: 0, height: 5 } }))).toBe('invalid');
    const left = (await admin.storage.from('post-media').list(`${O.id}/${id}`)).data ?? []; expect(left).toEqual([]);
    expect((await admin.from('posts').select('id').eq('id', id)).data).toEqual([]);
  });

  it('signed URLs live exactly SIGNED_URL_TTL_S (120) seconds', async () => {
    const p = (await oApi.profilePosts(ho)).items[0]!; const m = await oApi.mediaUrls([{ bucket: 'post-media', path: p.media!.thumbPath! }]); const url = [...m.values()][0]!;
    const { exp } = jwtExp(url); const left = exp - Math.floor(Date.now() / 1000); expect(SIGNED_URL_TTL_S).toBe(120); expect(left).toBeLessThanOrEqual(120); expect(left).toBeGreaterThan(100);
  });

  it('profileByHandle maps the relationship, the lock and the blurred avatar for each viewer', async () => {
    const { photoId } = await addProfilePhoto(O); await new SupabaseAccountApi(O.sb, O.id, O.email).saveAvatar(photoId, { x: 0.5, y: 0.5, zoom: 1 }, BH);
    const asStranger = (await sApi.profileByHandle(ho))!; expect(asStranger).toMatchObject({ username: ho, isPrivate: true, restricted: true, relationship: 'stranger', photoPath: null, avatarBlurhash: BH, isSample: false, isSelf: false });
    expect((await fApi.profileByHandle(ho))!).toMatchObject({ relationship: 'follower', restricted: false }); expect((await fApi.profileByHandle(ho))!.photoPath).toBeTruthy();
    expect((await oApi.profileByHandle(ho))!).toMatchObject({ relationship: 'self', isSelf: true }); expect(await sApi.profileByHandle('nobody.such.handle')).toBeNull();
    await sApi.follow(O.id); expect((await sApi.profileByHandle(ho))!.relationship).toBe('pending'); await sApi.unfollow(O.id);
  });

  it('followersOf / followingOf are gated and return cards without private keys', async () => {
    expect((await sApi.followersOf(ho)).items, 'a stranger gets nothing').toEqual([]);
    const f = (await fApi.followersOf(ho)).items; expect(f.map((c) => c.userId)).toEqual([F.id]); expect(Object.keys(f[0]!).sort()).toEqual(['avatarBlurhash', 'avatarCrop', 'cursor', 'displayName', 'followStatus', 'isPrivate', 'isSample', 'photoPath', 'userId', 'username']);
    expect((await oApi.followingOf(ho)).items).toEqual([]); expect((await fApi.followingOf(await handleOf(F))).items.map((c) => c.userId)).toEqual([O.id]);
  });

  it('search and suggested return limited cards; short queries return nothing without a request', async () => {
    const hit = (await sApi.search(ho.slice(0, 8))).find((c) => c.userId === O.id)!; expect(hit).toMatchObject({ isPrivate: true, photoPath: null, avatarBlurhash: BH });
    const calls: string[] = []; const spy = new Proxy(S.sb, { get: (t, k) => { if (k === 'rpc') return (fn: string, a: never) => { calls.push(fn); return t.rpc(fn, a); }; return (t as never)[k]; } });
    expect(await new SupabaseSocialApi(spy as never, S.id).search('a')).toEqual([]); expect(calls).toEqual([]);
    const N = await createUser('apNewbie'); const sug = await social(N).suggested(); expect(sug.every((c) => !c.isPrivate)).toBe(true); expect(sug.map((c) => c.userId)).not.toContain(O.id);
  });

  it('a report on a sample is a typed "sample" failure with a clear message', async () => {
    const T = await createUser('apSample'); must(await admin.from('profiles').update({ is_sample: true }).eq('user_id', T.id), 'flag');
    const err = await sApi.report('profile', T.id, 'spam', '').catch((e: unknown) => e) as SocialFailure; expect(err).toBeInstanceOf(SocialFailure); expect(err.code).toBe('sample'); expect(err.message).toBe('This is sample content, so there is nobody to report.');
    expect(await sApi.sampleFlags([T.id, S.id])).toEqual(new Set([T.id])); expect(await sApi.sampleFlags([])).toEqual(new Set());
    expect((await sApi.profileByHandle(await handleOf(T)))!.isSample).toBe(true);
  });
});

describe('SupabaseAccountApi: the Phase 4.5 settings', () => {
  it('load exposes the new fields, setAccountPrivate and saveSocialSettings round-trip, saveAvatar stores a blurhash and rejects junk', async () => {
    const U = await createUser('apAcct'); const api = new SupabaseAccountApi(U.sb, U.id, U.email);
    expect(await api.load()).toMatchObject({ searchable: true, showAvatarToEveryone: false, avatarBlurhash: null, isSample: false, socialVisibility: 'public' });
    await api.setAccountPrivate(true); expect((await api.load()).socialVisibility).toBe('followers'); await api.setAccountPrivate(false); expect((await api.load()).socialVisibility).toBe('public');
    await api.saveSocialSettings({ allowComments: 'followers', showFollowerCounts: false, searchable: false, showAvatarToEveryone: true });
    expect(await api.load()).toMatchObject({ allowComments: 'followers', showFollowerCounts: false, searchable: false, showAvatarToEveryone: true });
    const { photoId } = await addProfilePhoto(U); await api.saveAvatar(photoId, { x: 0.4, y: 0.6, zoom: 1.2 }, BH); expect(await api.load()).toMatchObject({ avatarPhotoId: photoId, avatarBlurhash: BH });
    expect(await code(api.saveAvatar(photoId, { x: 0.4, y: 0.6, zoom: 1.2 }, 'no spaces allowed <script>'))).toBe('invalid');
    await api.saveAvatar(null, null); expect((await api.load()).avatarBlurhash).toBeNull();
  });
});

describe('SupabaseDatingApi: sample flag on cards', () => {
  it('a flagged sample is marked on its Discover card and profile, and liking it stores nothing', async () => {
    const V = await datingUser('apDV', { place: 'lisbon', discoverable: true }); const T = await datingUser('apDT', { place: 'lisbon', discoverable: true });
    must(await admin.from('profiles').update({ is_sample: true }).eq('user_id', T.id), 'flag');
    const api = new SupabaseDatingApi(V.sb); const deck = (await api.discover()).items; const card = deck.find((c) => c.userId === T.id)!; expect(card, 'the sample is in the deck').toBeTruthy(); expect(card.isSample).toBe(true);
    expect(deck.filter((c) => c.userId !== T.id).every((c) => c.isSample === false)).toBe(true);
    expect((await api.profile(T.id))!.isSample).toBe(true); expect(await api.like(T.id)).toEqual({ matched: false, matchId: null });
    expect((await admin.from('dating_actions').select('*').eq('target_id', T.id)).data).toEqual([]);
  });
});
