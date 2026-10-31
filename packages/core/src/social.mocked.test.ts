// MOCKED tests: FakeSocialApi against the documented rules. These prove the UI-facing contract and the fake's own logic.
// They are NOT evidence that the database enforces anything: see tests/integration for that.
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSocialApi, FakeSocialWorld, SocialFailure, type FakeUser } from './index';

let w: FakeSocialWorld; let me: FakeSocialApi, ann: FakeSocialApi, guarded: FakeSocialApi;
let U: { me: FakeUser; ann: FakeUser; gate: FakeUser };
beforeEach(() => {
  w = new FakeSocialWorld();
  U = { me: w.addUser({ name: 'Me' }), ann: w.addUser({ name: 'Ann' }), gate: w.addUser({ name: 'Gate', visibility: 'followers' }) };
  me = new FakeSocialApi(w, U.me.id); ann = new FakeSocialApi(w, U.ann.id); guarded = new FakeSocialApi(w, U.gate.id);
});
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof SocialFailure ? e.code : 'other'; } };

describe('posting and feeds (fake)', () => {
  it('creates, lists newest first, and deletes with cascade', async () => {
    await me.createPost({ id: crypto.randomUUID(), caption: 'one', audience: 'public', image: null });
    const id2 = crypto.randomUUID();
    await me.createPost({ id: id2, caption: 'two', audience: 'public', image: null });
    expect((await me.authorPosts(U.me.id)).items.map((p) => p.caption)).toEqual(['two', 'one']);
    await ann.like(id2); await ann.addComment(id2, 'hi'); await ann.save(id2);
    await me.deletePost(id2);
    expect(w.likes.size + w.saves.size + w.comments.length + w.notes.length).toBe(0);
    expect(await code(ann.like(id2))).toBe('not_found');
  });
  it('rejects empty and over-long posts and duplicate ids', async () => {
    const id = crypto.randomUUID();
    expect(await code(me.createPost({ id, caption: '  ', audience: 'public', image: null }))).toBe('invalid');
    expect(await code(me.createPost({ id, caption: 'x'.repeat(2201), audience: 'public', image: null }))).toBe('invalid');
    expect(await code(me.createPost({ id, caption: 'ok', audience: 'public', image: null }))).toBe('ok');
    expect(await code(me.createPost({ id, caption: 'ok', audience: 'public', image: null })), 'same author retry is idempotent').toBe('ok');
    expect(w.posts.filter((p) => p.id === id)).toHaveLength(1);
    expect(await code(ann.createPost({ id, caption: 'steal', audience: 'public', image: null }))).toBe('invalid');
  });
  it('Explore is public posts from public profiles; Following is accepted follows plus own', async () => {
    await ann.createPost({ id: crypto.randomUUID(), caption: 'ann public', audience: 'public', image: null });
    await ann.createPost({ id: crypto.randomUUID(), caption: 'ann followers', audience: 'followers', image: null });
    await guarded.createPost({ id: crypto.randomUUID(), caption: 'gate public', audience: 'public', image: null });
    expect((await me.feed('explore')).items.map((p) => p.caption)).toEqual(['ann public']);
    expect((await me.feed('following')).items).toHaveLength(0);
    await me.follow(U.ann.id); await me.follow(U.gate.id);
    expect((await me.feed('following')).items.map((p) => p.caption)).toEqual(['ann followers', 'ann public']);
    await guarded.respondToRequest(U.me.id, true);
    expect((await me.feed('following')).items.map((p) => p.caption)).toEqual(['gate public', 'ann followers', 'ann public']);
    expect((await me.feed('explore')).items.map((p) => p.caption), 'a followers-only profile never reaches Explore').toEqual(['ann public']);
  });
  it('keyset paging returns each post once and rejects forged cursors', async () => {
    for (let i = 0; i < 20; i++) await ann.createPost({ id: crypto.randomUUID(), caption: `p${i}`, audience: 'public', image: null });
    const p1 = await me.feed('explore'); expect(p1.items).toHaveLength(15); expect(p1.next).not.toBeNull();
    await ann.createPost({ id: crypto.randomUUID(), caption: 'late', audience: 'public', image: null });
    const p2 = await me.feed('explore', p1.next);
    expect(p2.items.map((p) => p.caption)).toEqual(['p4', 'p3', 'p2', 'p1', 'p0']); expect(p2.next).toBeNull();
    expect(await code(me.feed('explore', "x'; drop"))).toBe('invalid_cursor');
  });
});

describe('interactions (fake)', () => {
  it('refuses every action on a post the actor cannot see', async () => {
    const id = crypto.randomUUID(); await ann.createPost({ id, caption: 'secret', audience: 'followers', image: null });
    for (const f of [() => me.like(id), () => me.save(id), () => me.addComment(id, 'x'), () => me.comments(id), () => me.report('post', id, 'spam', '')]) expect(await code(f())).toBe('not_found');
  });
  it('likes are idempotent and notify once; unlike removes the notification', async () => {
    const id = crypto.randomUUID(); await ann.createPost({ id, caption: 'p', audience: 'public', image: null });
    await me.like(id); await me.like(id); await me.unlike(id); await me.like(id);
    expect((await ann.notifications()).items.filter((n) => n.type === 'like')).toHaveLength(1);
    expect(await ann.unreadCount()).toBe(1);
    await ann.markRead(); expect(await ann.unreadCount()).toBe(0);
  });
  it('comments can be deleted by their author or the post owner only', async () => {
    const id = crypto.randomUUID(); await ann.createPost({ id, caption: 'p', audience: 'public', image: null });
    const c = await me.addComment(id, 'mine'); const d = await guarded.addComment(id, 'theirs');
    expect(await code(guarded.deleteComment(c))).toBe('not_found');
    expect(await code(me.deleteComment(c))).toBe('ok'); expect(await code(ann.deleteComment(d))).toBe('ok');
  });
});

describe('follows, blocks and reports (fake)', () => {
  it('public follows are accepted, followers-only ones wait for the owner', async () => {
    expect(await me.follow(U.ann.id)).toBe('accepted'); expect(await me.follow(U.gate.id)).toBe('pending');
    expect(await me.follow(U.gate.id)).toBe('pending');
    expect(await code(me.follow(U.me.id))).toBe('invalid');
    expect(await guarded.counts()).toEqual({ following: 0, followers: 0, requests: 1 });
    expect(await code(ann.respondToRequest(U.me.id, true))).toBe('not_found');
    await guarded.respondToRequest(U.me.id, false);
    expect(await code(guarded.respondToRequest(U.me.id, true))).toBe('not_found');
  });
  it('blocking removes follows and hides the pair from each other everywhere', async () => {
    await me.follow(U.ann.id); await ann.follow(U.me.id);
    const id = crypto.randomUUID(); await ann.createPost({ id, caption: 'p', audience: 'public', image: null });
    await me.block(U.ann.id);
    expect(w.follows.size).toBe(0);
    expect(await me.profile(U.ann.id)).toBeNull(); expect(await ann.profile(U.me.id)).toBeNull();
    expect((await me.feed('explore')).items).toHaveLength(0);
    expect(await code(me.like(id))).toBe('not_found'); expect(await code(ann.follow(U.me.id))).toBe('not_found');
    expect((await me.blocked()).map((b) => b.displayName)).toEqual(['Ann']);
    await me.unblock(U.ann.id); expect((await me.feed('explore')).items).toHaveLength(1);
  });
  it('a restricted profile shows a name only', async () => {
    const p = await me.profile(U.gate.id);
    expect(p).toMatchObject({ restricted: true, displayName: 'Gate', bio: null, age: null, photoPath: null, followerCount: null });
  });
  it('reports are validated and throttled', async () => {
    expect(await code(me.report('profile', U.ann.id, 'spam', ''))).toBe('ok');
    expect(await code(me.report('profile', U.ann.id, 'nonsense' as never, ''))).toBe('invalid');
    for (let i = 0; i < 9; i++) await me.report('profile', U.ann.id, 'spam', '');
    expect(await code(me.report('profile', U.ann.id, 'spam', ''))).toBe('rate_limited');
  });
});

describe('failure injection (fake)', () => {
  it('fails once with a typed error and then recovers, so retry paths can be tested', async () => {
    me.failNext('network', 1, 'feed');
    expect(await code(me.feed('explore'))).toBe('network');
    expect(await code(me.feed('explore'))).toBe('ok');
  });
});
