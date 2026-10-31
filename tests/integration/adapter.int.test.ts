// INTEGRATION: the real SupabaseSocialApi adapter (apps/web/src/data) against the local stack.
// This is the only automated check that the adapter, its type mapping and its error mapping work with real Supabase.
import { beforeAll, describe, expect, it } from 'vitest';
import { UserScope, SocialFailure, type SocialApi } from '@lovoki/core';
import { SupabaseSocialApi } from '../../apps/web/src/data/SupabaseSocialApi';
import { PNG, createUser, rid, rpc, type TestUser } from './harness';

let A: TestUser, B: TestUser, G: TestUser; // G: followers-only profile
let a: SocialApi, b: SocialApi, g: SocialApi; const scope = new UserScope();
const png = () => new Blob([PNG], { type: 'image/png' });
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof SocialFailure ? e.code : `other:${String(e)}`; } };

beforeAll(async () => {
  [A, B, G] = await Promise.all([createUser('adA'), createUser('adB'), createUser('adG', { visibility: 'followers' })]);
  a = new SupabaseSocialApi(A.sb, A.id, scope); b = new SupabaseSocialApi(B.sb, B.id); g = new SupabaseSocialApi(G.sb, G.id);
});

describe('SupabaseSocialApi against the real stack', () => {
  it('creates a post with an image, shows it to others with batched signed URLs, and deletes it with its file', async () => {
    const id = rid();
    await a.createPost({ id, caption: 'hello adapter', audience: 'public', image: png() });
    const row = (await b.feed('explore')).items.find((p) => p.id === id)!;
    expect(row).toMatchObject({ authorId: A.id, authorName: 'adA', caption: 'hello adapter', audience: 'public', likeCount: 0, likedByMe: false, isMine: false });
    expect(row.media).toMatchObject({ contentType: 'image/png' });
    expect(row.cursor).toMatch(/\|/);
    const urls = await b.mediaUrls([{ bucket: 'post-media', path: row.media!.path }, { bucket: 'profile-photos', path: row.authorPhotoPath! }]);
    expect(urls.size, 'one URL per requested image').toBe(2);
    expect((await fetch(urls.get(row.media!.path)!)).ok).toBe(true);
    const path = row.media!.path;
    await a.deletePost(id);
    expect((await b.feed('explore')).items.some((p) => p.id === id)).toBe(false);
    const gone = await new SupabaseSocialApi(B.sb, B.id).mediaUrls([{ bucket: 'post-media', path }]); // fresh adapter: b still holds its cached URL
    expect(gone.has(path), 'no URL for a deleted file').toBe(false);
    expect((await fetch(urls.get(path)!)).ok, 'the previously issued URL no longer serves the deleted file').toBe(false);
  });
  it('caches signed URLs per session and forgets them when the scope is cleared (logout)', async () => {
    const id = rid(); await a.createPost({ id, caption: 'cache', audience: 'public', image: png() });
    const path = (await a.authorPosts(A.id)).items.find((p) => p.id === id)!.media!.path;
    let calls = 0; const orig = A.sb.storage.from.bind(A.sb.storage);
    (A.sb.storage as unknown as { from: unknown }).from = (bucket: string) => { const f = orig(bucket); const c = f.createSignedUrls.bind(f); f.createSignedUrls = (...args: Parameters<typeof c>) => { calls++; return c(...args); }; return f; };
    await a.mediaUrls([{ bucket: 'post-media', path }]); await a.mediaUrls([{ bucket: 'post-media', path }]);
    expect(calls, 'second call served from the session cache').toBe(1);
    expect(scope.clearAll()).toEqual([]);
    await a.mediaUrls([{ bucket: 'post-media', path }]);
    expect(calls, 'after logout the cache is empty and URLs are fetched again').toBe(2);
    (A.sb.storage as unknown as { from: unknown }).from = orig;
  });
  it('likes, saves and comments round-trip with correct counts and flags', async () => {
    const id = rid(); await a.createPost({ id, caption: 'engage', audience: 'public', image: null });
    expect(await b.like(id)).toEqual({ liked: true, likeCount: 1 });
    expect(await b.like(id)).toEqual({ liked: true, likeCount: 1 });
    await b.save(id);
    const cid = await b.addComment(id, 'nice');
    const mine = (await b.authorPosts(A.id)).items.find((p) => p.id === id)!;
    expect(mine).toMatchObject({ likeCount: 1, likedByMe: true, savedByMe: true, commentCount: 1 });
    expect((await a.comments(id)).items).toMatchObject([{ id: cid, authorName: 'adB', body: 'nice', canDelete: true }]);
    expect((await b.savedPosts()).items.map((p) => p.id)).toContain(id);
    expect(await b.unlike(id)).toEqual({ liked: false, likeCount: 0 });
    await b.unsave(id); await a.deleteComment(cid);
    expect((await a.authorPosts(A.id)).items.find((p) => p.id === id)!.commentCount).toBe(0);
  });
  it('maps database errors to typed failures without leaking database text', async () => {
    const hidden = rid(); await g.createPost({ id: hidden, caption: 'followers only', audience: 'followers', image: null });
    expect(await fails(b.like(hidden))).toBe('not_found');
    expect(await fails(b.createPost({ id: rid(), caption: '   ', audience: 'public', image: null }))).toBe('invalid');
    expect(await fails(b.feed('explore', 'not-a-cursor'))).toBe('invalid_cursor');
    expect(await fails(b.addComment(hidden, 'x'))).toBe('not_found');
    expect(await fails(b.follow(B.id))).toBe('invalid');
    try { await b.like(hidden); } catch (e) { expect((e as Error).message).not.toMatch(/LOVOKI_|postgres|violates|function/i); }
    const bad = await fails(new SupabaseSocialApi(B.sb, B.id).createPost({ id: rid(), caption: 'x', audience: 'public', image: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) }));
    expect(bad, 'bytes that are not an image are refused before upload').toBe('invalid');
  });
  it('follow requests, people lists, counts, profile and notifications', async () => {
    expect(await b.follow(G.id)).toBe('pending');
    expect((await b.profile(G.id))).toMatchObject({ restricted: true, displayName: 'adG', bio: null, followStatus: 'pending' });
    expect((await g.people('requests')).items.map((p) => p.userId)).toEqual([B.id]);
    expect(await g.counts()).toEqual({ following: 0, followers: 0, requests: 1 });
    const n = (await g.notifications()).items; expect(n[0]).toMatchObject({ type: 'follow_request', actorId: B.id, followStatus: 'pending', read: false });
    expect(await g.unreadCount()).toBe(1);
    await g.respondToRequest(B.id, true);
    expect(await g.counts()).toEqual({ following: 0, followers: 1, requests: 0 });
    expect((await b.profile(G.id))).toMatchObject({ restricted: false, bio: 'Bio of adG', followStatus: 'accepted' });
    expect((await b.notifications()).items.some((x) => x.type === 'follow_accepted')).toBe(true);
    await g.markRead(); expect(await g.unreadCount()).toBe(0);
    expect((await b.people('following')).items.map((p) => [p.userId, p.status])).toEqual([[G.id, 'accepted']]);
    await b.unfollow(G.id); expect((await b.people('following')).items).toHaveLength(0);
  });
  it('blocks and reports', async () => {
    expect(await a.profile(B.id)).not.toBeNull();
    await a.block(B.id);
    expect(await a.profile(B.id)).toBeNull();
    expect((await a.blocked()).map((x) => x.userId)).toEqual([B.id]);
    await a.unblock(B.id);
    const id = rid(); await b.createPost({ id, caption: 'report me', audience: 'public', image: null });
    await a.report('post', id, 'spam', 'saved for review'); await a.report('post', id, 'scam', '');
    expect(await fails(a.report('post', id, 'nonsense' as never, ''))).toBe('invalid');
    await rpc(A, 'unread_notification_count');
  });
});
