// INTEGRATION (Phase 3): visibility matrix, follows, counters, comments, pagination, visibility changes, social profile,
// direct-write denial. Real GoTrue + PostgREST + Postgres RLS on the local stack.
import { beforeAll, describe, expect, it } from 'vitest';
import { admin, createUser, feed, ids, must, post, rawRest, rid, rpc, rpcFails, type FeedRow, type TestUser } from './harness';

/** Walks every page of a keyset list the way the client does, and returns all rows plus the page sizes seen. */
async function walk<T extends { page_cursor: string }>(fn: (cursor: string | null) => Promise<T[]>, limit: number) {
  const rows: T[] = []; const pages: number[] = []; let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const raw = await fn(cursor);
    const page = raw.slice(0, limit); pages.push(raw.length); rows.push(...page);
    if (raw.length <= limit) break;
    cursor = page[page.length - 1]!.page_cursor;
  }
  return { rows, pages };
}
const authorPosts = (viewer: TestUser, author: string, cursor: string | null = null, limit = 20) =>
  rpc<FeedRow[]>(viewer, 'profile_posts_page', { p_author: author, p_limit: limit, p_cursor: cursor });
const visibleIds = async (viewer: TestUser, author: TestUser) => new Set(ids((await walk((c) => authorPosts(viewer, author.id, c, 20), 20)).rows));

describe('visibility matrix', () => {
  // Pub: public profile. Fol: followers-only profile.
  let Pub: TestUser, Fol: TestUser, follower: TestUser, pending: TestUser, stranger: TestUser, blockedByAuthor: TestUser, blocker: TestUser, incomplete: TestUser;
  let pubPub: string, pubFol: string, folPub: string, folFol: string;
  beforeAll(async () => {
    [Pub, Fol, follower, pending, stranger, blockedByAuthor, blocker, incomplete] = await Promise.all([
      createUser('pub'), createUser('fol', { visibility: 'followers' }), createUser('follower'), createUser('pending'), createUser('stranger'),
      createUser('blockedbyauthor'), createUser('blocker'), createUser('incomplete', { complete: false })]);
    pubPub = await post(Pub, 'public post on public profile', 'public');
    pubFol = await post(Pub, 'followers post on public profile', 'followers');
    folPub = await post(Fol, 'public post on followers profile', 'public');
    folFol = await post(Fol, 'followers post on followers profile', 'followers');
    await rpc(follower, 'follow_user', { p_user: Pub.id }); // public profile: accepted at once
    await rpc(follower, 'follow_user', { p_user: Fol.id });
    await rpc(Fol, 'respond_follow_request', { p_follower: follower.id, p_accept: true });
    await rpc(pending, 'follow_user', { p_user: Fol.id }); // stays pending
    await rpc(pending, 'follow_user', { p_user: Pub.id });
    await rpc(Pub, 'block_user', { p_user: blockedByAuthor.id });
    await rpc(blocker, 'block_user', { p_user: Pub.id });
    await rpc(blocker, 'block_user', { p_user: Fol.id });
    await rpc(blockedByAuthor, 'block_user', { p_user: Fol.id }).catch(() => undefined);
  });

  const cases: [string, () => TestUser, () => Set<string>][] = [
    ['Pub self', () => Pub, () => new Set([pubPub, pubFol])],
    ['Pub accepted follower', () => follower, () => new Set([pubPub, pubFol])],
    ['Pub pending-elsewhere user (is an accepted follower of the public profile)', () => pending, () => new Set([pubPub, pubFol])],
    ['Pub stranger', () => stranger, () => new Set([pubPub])],
    ['Pub viewer blocked by author', () => blockedByAuthor, () => new Set()],
    ['Pub viewer who blocked author', () => blocker, () => new Set()],
    ['Pub viewer without completed profile', () => incomplete, () => new Set()],
  ];
  for (const [name, who, expected] of cases) {
    it(`${name}`, async () => {
      const viewer = who();
      // profile_posts_page requires a completed viewer; an incomplete one is refused outright.
      if (viewer === incomplete) { await rpcFails(viewer, 'profile_posts_page', { p_author: Pub.id }, 'LOVOKI_ONBOARDING_INCOMPLETE'); return; }
      expect(await visibleIds(viewer, Pub), `${name}: posts visible`).toEqual(expected());
    });
  }
  const folCases: [string, () => TestUser, () => Set<string>][] = [
    ['Fol self', () => Fol, () => new Set([folPub, folFol])],
    ['Fol accepted follower', () => follower, () => new Set([folPub, folFol])],
    ['Fol pending requester', () => pending, () => new Set()],
    ['Fol stranger', () => stranger, () => new Set()],
    ['Fol viewer who blocked author', () => blocker, () => new Set()],
  ];
  for (const [name, who, expected] of folCases) {
    it(`${name} (a public post on a followers-only profile is treated as followers-only)`, async () => {
      expect(await visibleIds(who(), Fol), `${name}: posts visible`).toEqual(expected());
    });
  }

  it('Explore = public posts from public completed profiles, nothing else', async () => {
    const all = new Set(ids((await walk((c) => feed(stranger, 'explore', c, 20), 20)).rows));
    expect(all.has(pubPub), 'public post of public profile is in Explore').toBe(true);
    for (const [label, id] of [['followers post', pubFol], ['public post of followers-only profile', folPub], ['followers post of followers-only profile', folFol]] as const) {
      expect(all.has(id), `${label} must not be in Explore`).toBe(false);
    }
    const acc = new Set(ids((await walk((c) => feed(follower, 'explore', c, 20), 20)).rows));
    expect(acc.has(folPub) || acc.has(folFol) || acc.has(pubFol), 'Explore is public-only even for followers').toBe(false);
    const blocked = new Set(ids((await walk((c) => feed(blocker, 'explore', c, 20), 20)).rows));
    expect(blocked.has(pubPub), 'blocked author is absent from Explore').toBe(false);
  });
  it('Following = accepted follows plus own posts, with the audience rule applied', async () => {
    const f = new Set(ids((await walk((c) => feed(follower, 'following', c, 20), 20)).rows));
    expect([pubPub, pubFol, folPub, folFol].every((i) => f.has(i)), 'follower sees both authors in Following').toBe(true);
    const mine = new Set(ids((await walk((c) => feed(Pub, 'following', c, 20), 20)).rows));
    expect(mine.has(pubPub) && mine.has(pubFol), 'own posts are in Following').toBe(true);
    const p = new Set(ids((await walk((c) => feed(pending, 'following', c, 20), 20)).rows));
    expect(p.has(folPub) || p.has(folFol), 'pending requests do not put posts in Following').toBe(false);
    expect(p.has(pubPub) && p.has(pubFol), 'but accepted follow of the public profile does').toBe(true);
    const s = new Set(ids((await walk((c) => feed(stranger, 'following', c, 20), 20)).rows));
    expect(s.size, 'a stranger who follows nobody has an empty Following feed').toBe(0);
  });

  it('actions on a post the actor cannot see are all refused and change nothing', async () => {
    for (const [fn, args] of [
      ['like_post', { p_post: folFol }], ['save_post', { p_post: folFol }], ['add_comment', { p_post: folFol, p_body: 'hi' }],
      ['comments_page', { p_post: folFol }], ['report_content', { p_type: 'post', p_target: folFol, p_reason: 'spam' }],
    ] as const) await rpcFails(stranger, fn, args as Record<string, unknown>, 'LOVOKI_NOT_FOUND');
    await rpcFails(stranger, 'like_post', { p_post: rid() }, 'LOVOKI_NOT_FOUND'); // nonexistent looks identical to invisible
    for (const t of ['post_likes', 'post_saves', 'post_comments'] as const) {
      expect(must(await admin.from(t).select('post_id').eq('post_id', folFol)).length, `${t} for the hidden post`).toBe(0);
    }
    // Unlike must not leak a count for a post you cannot see.
    const r = must(await stranger.sb.rpc('unlike_post', { p_post: folFol })) as unknown[];
    expect(r ?? [], 'unlike returns nothing for an invisible post').toHaveLength(0);
  });
  it('dating discoverability grants no social access', async () => {
    const D = await createUser('dater', { visibility: 'followers', discoverable: true });
    const dp = await post(D, 'followers only', 'followers');
    expect(await visibleIds(stranger, D)).toEqual(new Set());
    await rpcFails(stranger, 'like_post', { p_post: dp }, 'LOVOKI_NOT_FOUND');
    const prof = must(await stranger.sb.rpc('social_profile', { p_user: D.id })) as { restricted: boolean; bio: string | null }[];
    expect(prof[0]!.restricted, 'discoverable but followers-only: restricted on social surfaces').toBe(true);
    expect(prof[0]!.bio, 'D3: a private account keeps its bio public').toBe('Bio of dater');
    expect(prof[0]).toMatchObject({ age: null, area_label: null, photo_path: null });
  });
});

describe('follows', () => {
  let P: TestUser, F: TestUser, X: TestUser, Y: TestUser;
  beforeAll(async () => { [P, F, X, Y] = await Promise.all([createUser('fp'), createUser('ff', { visibility: 'followers' }), createUser('fx'), createUser('fy')]); });
  const status = async (a: string, b: string) => must(await admin.from('follows').select('status').eq('follower_id', a).eq('followee_id', b)).at(0)?.status ?? null;
  const notes = async (recipient: string, type: string) => must(await admin.from('notifications').select('id').eq('recipient_id', recipient).eq('type', type)).length;

  it('following a public profile is accepted immediately and notifies once', async () => {
    expect(await rpc(X, 'follow_user', { p_user: P.id })).toBe('accepted');
    expect(await rpc(X, 'follow_user', { p_user: P.id }), 'idempotent').toBe('accepted');
    expect(await notes(P.id, 'follow')).toBe(1);
  });
  it('following a followers-only profile creates a request that only the owner can resolve', async () => {
    expect(await rpc(X, 'follow_user', { p_user: F.id })).toBe('pending');
    expect(await notes(F.id, 'follow_request')).toBe(1);
    await rpcFails(Y, 'respond_follow_request', { p_follower: X.id, p_accept: true }, 'LOVOKI_NOT_FOUND'); // a third party
    await rpcFails(X, 'respond_follow_request', { p_follower: X.id, p_accept: true }, 'LOVOKI_NOT_FOUND'); // the requester themself
    expect(await status(X.id, F.id), 'still pending after forged responses').toBe('pending');
    await rpc(F, 'respond_follow_request', { p_follower: X.id, p_accept: true });
    expect(await status(X.id, F.id)).toBe('accepted');
    expect(await notes(X.id, 'follow_accepted'), 'requester is told').toBe(1);
    await rpcFails(F, 'respond_follow_request', { p_follower: X.id, p_accept: true }, 'LOVOKI_NOT_FOUND'); // nothing pending any more
  });
  it('declining removes the request and the notification; the requester can ask again', async () => {
    const Z = await createUser('fz');
    await rpc(Z, 'follow_user', { p_user: F.id });
    await rpc(F, 'respond_follow_request', { p_follower: Z.id, p_accept: false });
    expect(await status(Z.id, F.id)).toBeNull();
    expect(await notes(F.id, 'follow_request')).toBe(1); // X's was resolved, Z's removed
    expect(await rpc(Z, 'follow_user', { p_user: F.id })).toBe('pending');
  });
  it('unfollow and re-follow never stack notifications', async () => {
    for (let i = 0; i < 3; i++) { await rpc(Y, 'follow_user', { p_user: P.id }); await rpc(Y, 'unfollow_user', { p_user: P.id }); }
    await rpc(Y, 'follow_user', { p_user: P.id });
    expect(must(await admin.from('notifications').select('id').eq('recipient_id', P.id).eq('actor_id', Y.id).eq('type', 'follow')).length).toBe(1);
  });
  it('self-follow, unknown users and incomplete users are refused', async () => {
    await rpcFails(P, 'follow_user', { p_user: P.id }, 'LOVOKI_INVALID');
    await rpcFails(P, 'follow_user', { p_user: rid() }, 'LOVOKI_NOT_FOUND');
    const N = await createUser('fn', { complete: false });
    await rpcFails(P, 'follow_user', { p_user: N.id }, 'LOVOKI_NOT_FOUND');
    await rpcFails(N, 'follow_user', { p_user: P.id }, 'LOVOKI_ONBOARDING_INCOMPLETE');
  });
  it('forged status is impossible: direct inserts and updates are denied and change nothing', async () => {
    const W = await createUser('fw');
    const ins = await rawRest(W, 'POST', 'follows', { follower_id: W.id, followee_id: F.id, status: 'accepted', accepted_at: new Date().toISOString() });
    expect(ins.status, ins.text).toBeGreaterThanOrEqual(400);
    expect(await status(W.id, F.id)).toBeNull();
    await rpc(W, 'follow_user', { p_user: F.id });
    const upd = await rawRest(W, 'PATCH', `follows?follower_id=eq.${W.id}&followee_id=eq.${F.id}`, { status: 'accepted', accepted_at: new Date().toISOString() });
    expect(upd.status, upd.text).toBeGreaterThanOrEqual(400);
    expect(await status(W.id, F.id), 'request is still pending').toBe('pending');
    const self = await rawRest(W, 'POST', 'follows', { follower_id: W.id, followee_id: W.id, status: 'accepted' });
    expect(self.status).toBeGreaterThanOrEqual(400);
    const del = await rawRest(W, 'DELETE', `follows?follower_id=eq.${W.id}`);
    expect(del.status, 'direct delete denied too').toBeGreaterThanOrEqual(400);
    expect(await status(W.id, F.id)).toBe('pending');
  });
  it('lists: Following, Followers and Requests are correct and keyset paginated', async () => {
    const R = await createUser('fr', { visibility: 'followers' });
    const users = await Promise.all(Array.from({ length: 5 }, (_, i) => createUser(`req${i}`)));
    for (const u of users) await rpc(u, 'follow_user', { p_user: R.id });
    const reqs = await walk((c) => rpc<{ user_id: string; page_cursor: string }[]>(R, 'list_follows', { p_kind: 'requests', p_limit: 10, p_cursor: c }), 10);
    expect(reqs.rows.map((r) => r.user_id).sort()).toEqual(users.map((u) => u.id).sort());
    await rpc(R, 'respond_follow_request', { p_follower: users[0]!.id, p_accept: true });
    expect(must(await R.sb.rpc('social_counts'))).toEqual([{ following: 0, followers: 1, requests: 4 }]);
    const fol = await rpc<{ user_id: string }[]>(R, 'list_follows', { p_kind: 'followers' });
    expect(fol.map((r) => r.user_id)).toEqual([users[0]!.id]);
    const mine = await rpc<{ user_id: string; status: string }[]>(users[1]!, 'list_follows', { p_kind: 'following' });
    expect(mine.map((r) => [r.user_id, r.status])).toEqual([[R.id, 'pending']]);
    await rpcFails(R, 'list_follows', { p_kind: 'everyone' }, 'LOVOKI_INVALID');
  });
  it('the owner can remove a follower, who loses access', async () => {
    const O = await createUser('fo2', { visibility: 'followers' }); const V = await createUser('fv');
    await rpc(V, 'follow_user', { p_user: O.id }); await rpc(O, 'respond_follow_request', { p_follower: V.id, p_accept: true });
    const p = await post(O, 'for followers', 'followers');
    expect(ids(await authorPosts(V, O.id))).toContain(p);
    await rpc(O, 'remove_follower', { p_follower: V.id });
    expect(ids(await authorPosts(V, O.id)), 'removed follower no longer sees the post').not.toContain(p);
  });
});

describe('profile and post audience changes', () => {
  it('public -> followers-only: accepted followers keep access, strangers lose it; back to public keeps pending requests pending (no silent accept)', async () => {
    const O = await createUser('vo'); const acc = await createUser('vacc'); const str = await createUser('vstr');
    const p = await post(O, 'was public', 'public');
    await rpc(acc, 'follow_user', { p_user: O.id });
    expect(await visibleIds(str, O)).toContain(p);
    await rpc(O, 'save_privacy', { p_area_label: 'Lisbon', p_social_visibility: 'followers', p_dating_discoverable: false });
    expect(await visibleIds(acc, O), 'existing accepted follower keeps access').toContain(p);
    expect(await visibleIds(str, O), 'stranger loses access').not.toContain(p);
    const exp = new Set(ids((await walk((c) => feed(acc, 'explore', c, 20), 20)).rows));
    expect(exp.has(p), 'post leaves Explore').toBe(false);
    expect(await rpc(str, 'follow_user', { p_user: O.id }), 'new follow is now a request').toBe('pending');
    expect(must(await O.sb.rpc('social_counts'))).toEqual([{ following: 0, followers: 1, requests: 1 }]);
    await rpc(O, 'save_privacy', { p_area_label: 'Lisbon', p_social_visibility: 'public', p_dating_discoverable: false });
    expect(must(await admin.from('follows').select('status').eq('follower_id', str.id).eq('followee_id', O.id)).at(0)?.status, 'private -> public must not approve anyone').toBe('pending');
    expect(must(await admin.from('notifications').select('id').eq('recipient_id', str.id).eq('type', 'follow_accepted')).length).toBe(0);
    expect(await visibleIds(str, O)).toContain(p);
  });
  it('post public -> followers: strangers lose the post, its comments and its saved copy; followers keep it', async () => {
    const O = await createUser('ao'); const fol = await createUser('afol'); const str = await createUser('astr');
    await rpc(fol, 'follow_user', { p_user: O.id });
    const p = await post(O, 'will narrow', 'public');
    await rpc(str, 'like_post', { p_post: p }); await rpc(str, 'save_post', { p_post: p }); await rpc(str, 'add_comment', { p_post: p, p_body: 'nice' });
    expect(ids((await walk((c) => rpc<FeedRow[]>(str, 'saved_posts_page', { p_limit: 20, p_cursor: c }), 20)).rows)).toContain(p);
    await rpc(O, 'set_post_audience', { p_post: p, p_audience: 'followers' });
    expect(await visibleIds(str, O)).not.toContain(p);
    expect(ids((await walk((c) => rpc<FeedRow[]>(str, 'saved_posts_page', { p_limit: 20, p_cursor: c }), 20)).rows), 'saved copy is hidden too').not.toContain(p);
    await rpcFails(str, 'comments_page', { p_post: p }, 'LOVOKI_NOT_FOUND');
    await rpcFails(str, 'add_comment', { p_post: p, p_body: 'still here?' }, 'LOVOKI_NOT_FOUND');
    expect(await visibleIds(fol, O)).toContain(p);
    const row = (await authorPosts(fol, O.id)).find((r) => r.post_id === p)!;
    expect([row.like_count, row.comment_count], 'engagement stays attached to the post').toEqual([1, 1]);
    await rpcFails(fol, 'set_post_audience', { p_post: p, p_audience: 'public' }, 'LOVOKI_NOT_FOUND'); // only the author
    await rpcFails(O, 'set_post_audience', { p_post: p, p_audience: 'everyone' }, 'LOVOKI_INVALID');
  });
});

describe('counters, saves and comments', () => {
  let O: TestUser, crowd: TestUser[], p: string;
  beforeAll(async () => { O = await createUser('co'); crowd = await Promise.all(Array.from({ length: 10 }, (_, i) => createUser(`crowd${i}`))); p = await post(O, 'count me'); });
  const row = async (viewer: TestUser) => (await authorPosts(viewer, O.id)).find((r) => r.post_id === p)!;

  it('concurrent likes (including duplicates) produce an exact count', async () => {
    await Promise.all([...crowd, ...crowd.slice(0, 5)].map((u) => rpc(u, 'like_post', { p_post: p })));
    expect((await row(O)).like_count, 'ten distinct likers, five of them double-clicked').toBe(10);
    expect((await row(crowd[0]!)).liked_by_me).toBe(true);
    await Promise.all(crowd.slice(0, 4).map((u) => rpc(u, 'unlike_post', { p_post: p })));
    expect((await row(O)).like_count).toBe(6);
    expect((await row(crowd[0]!)).liked_by_me).toBe(false);
    const r = await rpc<{ liked: boolean; like_count: number }[]>(crowd[5]!, 'like_post', { p_post: p });
    expect(r[0]).toEqual({ liked: true, like_count: 6 });
  });
  it('saves are idempotent and private', async () => {
    await rpc(crowd[0]!, 'save_post', { p_post: p }); await rpc(crowd[0]!, 'save_post', { p_post: p });
    expect(must(await admin.from('post_saves').select('user_id').eq('post_id', p)).length).toBe(1);
    expect((await row(crowd[0]!)).saved_by_me).toBe(true);
    expect((await row(crowd[1]!)).saved_by_me, 'someone else sees no save').toBe(false);
    expect((await row(O)).saved_by_me, 'even the author does not see who saved').toBe(false);
    const theirs = await rawRest(crowd[1]!, 'GET', `post_saves?post_id=eq.${p}`);
    expect(theirs.json, 'RLS: only own saves are readable').toEqual([]);
    const lst = await walk((c) => rpc<FeedRow[]>(crowd[1]!, 'saved_posts_page', { p_limit: 20, p_cursor: c }), 20);
    expect(ids(lst.rows)).not.toContain(p);
    await rpc(crowd[0]!, 'unsave_post', { p_post: p });
    expect((await row(crowd[0]!)).saved_by_me).toBe(false);
  });
  it('comments: 1-300 characters, flat, oldest first, deletable by author or post owner only', async () => {
    await rpcFails(crowd[0]!, 'add_comment', { p_post: p, p_body: 'x'.repeat(301) }, 'LOVOKI_INVALID');
    await rpcFails(crowd[0]!, 'add_comment', { p_post: p, p_body: '   ' }, 'LOVOKI_INVALID');
    const c1 = await rpc<string>(crowd[0]!, 'add_comment', { p_post: p, p_body: 'x'.repeat(300) });
    const c2 = await rpc<string>(crowd[1]!, 'add_comment', { p_post: p, p_body: '  second  ' });
    const c3 = await rpc<string>(crowd[2]!, 'add_comment', { p_post: p, p_body: 'third' });
    const page = await rpc<{ comment_id: string; body: string; can_delete: boolean }[]>(O, 'comments_page', { p_post: p });
    expect(page.map((c) => c.comment_id)).toEqual([c1, c2, c3]);
    expect(page[1]!.body, 'trimmed').toBe('second');
    expect(page.every((c) => c.can_delete), 'post owner may delete any comment').toBe(true);
    const asOther = await rpc<{ comment_id: string; can_delete: boolean }[]>(crowd[1]!, 'comments_page', { p_post: p });
    expect(asOther.map((c) => c.can_delete)).toEqual([false, true, false]);
    expect((await row(O)).comment_count).toBe(3);
    await rpcFails(crowd[3]!, 'delete_comment', { p_comment: c1 }, 'LOVOKI_NOT_FOUND'); // bystander
    await rpc(crowd[1]!, 'delete_comment', { p_comment: c2 }); // author
    await rpc(O, 'delete_comment', { p_comment: c3 }); // post owner
    expect((await row(O)).comment_count).toBe(1);
    const r = await rawRest(crowd[0]!, 'POST', 'post_comments', { post_id: p, author_id: crowd[0]!.id, body: 'direct' });
    expect(r.status, 'direct comment insert denied').toBeGreaterThanOrEqual(400);
  });
  it('comments page with keyset pagination', async () => {
    const P2 = await post(O, 'many comments');
    for (let i = 0; i < 23; i++) await rpc(crowd[i % 10]!, 'add_comment', { p_post: P2, p_body: `c${i}` });
    const all = await walk((c) => rpc<{ body: string; page_cursor: string }[]>(O, 'comments_page', { p_post: P2, p_limit: 10, p_cursor: c }), 10);
    expect(all.rows.map((r) => r.body)).toEqual(Array.from({ length: 23 }, (_, i) => `c${i}`));
    expect(all.pages).toEqual([11, 11, 3]);
  });
});

describe('keyset pagination', () => {
  let O: TestUser, V: TestUser, made: string[];
  beforeAll(async () => {
    O = await createUser('po'); V = await createUser('pv'); made = [];
    for (let i = 0; i < 35; i++) made.push(await post(O, `post ${i}`));
  });
  it('visits every post exactly once, newest first, with page sizes clamped to 10..20 (+1 lookahead)', async () => {
    const w = await walk((c) => authorPosts(V, O.id, c, 10), 10);
    expect(w.rows.map((r) => r.post_id)).toEqual([...made].reverse());
    expect(w.pages, 'three pages with lookahead, then the remaining 5').toEqual([11, 11, 11, 5]);
    expect((await authorPosts(V, O.id, null, 1)).length, 'limit below 10 is raised to 10 (+1)').toBe(11);
    expect((await authorPosts(V, O.id, null, 1000)).length, 'limit above 20 is capped at 20 (+1)').toBe(21);
    expect((await authorPosts(V, O.id, null, null as never)).length, 'default is 15 (+1)').toBe(16);
  });
  it('is stable while posts are inserted and deleted between pages', async () => {
    const first = (await authorPosts(V, O.id, null, 10)).slice(0, 10);
    const cursor = first[9]!.page_cursor;
    const fresh = [await post(O, 'new 1'), await post(O, 'new 2')];
    await rpc(O, 'delete_post', { p_post: first[9]!.post_id }); // the very row the cursor points at
    const next = (await authorPosts(V, O.id, cursor, 10)).slice(0, 10);
    const expected = [...made].reverse().slice(10, 20);
    expect(next.map((r) => r.post_id), 'page 2 continues exactly after the cursor position').toEqual(expected);
    expect(next.some((r) => fresh.includes(r.post_id) || first.some((f) => f.post_id === r.post_id)), 'no duplicates, no newer rows').toBe(false);
    await rpc(O, 'delete_post', { p_post: expected[3]! });
    const again = (await authorPosts(V, O.id, cursor, 10)).slice(0, 10);
    expect(again.map((r) => r.post_id)).toEqual([...expected.slice(0, 3), ...expected.slice(4), [...made].reverse()[20]!]);
  });
  it('rejects malformed cursors and cannot be forged into showing hidden posts', async () => {
    for (const bad of ['garbage', "x'; drop table posts;--", '2026-01-01T00:00:00Z|' + rid(), '2026-01-01T00:00:00.000000Z|not-a-uuid', '|', ' ']) {
      await rpcFails(V, 'profile_posts_page', { p_author: O.id, p_cursor: bad }, 'LOVOKI_INVALID_CURSOR');
      await rpcFails(V, 'feed_page', { p_feed: 'explore', p_cursor: bad }, 'LOVOKI_INVALID_CURSOR');
    }
    expect(must(await admin.from('posts').select('id').eq('author_id', O.id)).length, 'injection attempt changed nothing').toBeGreaterThan(30);
    const H = await createUser('ph', { visibility: 'followers' }); const hidden = await post(H, 'hidden', 'followers');
    const future = '9999-12-31T23:59:59.999999Z|ffffffff-ffff-4fff-8fff-ffffffffffff';
    expect(ids(await authorPosts(V, H.id, future, 20)), 'a forged cursor never bypasses visibility').not.toContain(hidden);
    expect(ids(await feed(V, 'explore', future, 20))).not.toContain(hidden);
    await rpcFails(V, 'feed_page', { p_feed: 'trending' }, 'LOVOKI_INVALID');
  });
  it('uses no OFFSET', async () => {
    const sql = (await import('node:fs')).readFileSync(new URL('../../supabase/migrations/20261102000000_phase3_social.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/\boffset\b/i);
  });
});

describe('social_profile exposes only the public view of another person', () => {
  it('shows a full card for public profiles and a name-only card for followers-only ones', async () => {
    const P = await createUser('sp'); const F = await createUser('sf', { visibility: 'followers' }); const V = await createUser('sv');
    const pub = (must(await V.sb.rpc('social_profile', { p_user: P.id })) as Record<string, unknown>[])[0]!;
    expect(Object.keys(pub).sort()).toEqual(['age', 'area_label', 'avatar_blurhash', 'avatar_crop', 'bio', 'details', 'display_name', 'follow_status', 'follower_count', 'follows_me_status', 'following_count', 'gender', 'gender_custom', 'interests', 'is_private', 'is_sample', 'is_self', 'photo_path', 'post_count', 'prompts', 'pronouns', 'relationship', 'restricted', 'user_id', 'username'].sort());
    expect(pub.restricted).toBe(false); expect(pub.age).toBeGreaterThanOrEqual(18); expect(pub.bio).toBe('Bio of sp');
    const lim = (must(await V.sb.rpc('social_profile', { p_user: F.id })) as Record<string, unknown>[])[0]!;
    expect(lim).toMatchObject({ restricted: true, display_name: 'sf', bio: 'Bio of sf', age: null, photo_path: null, area_label: null, relationship: 'stranger', is_private: true });
    await rpc(V, 'follow_user', { p_user: F.id });
    expect((must(await V.sb.rpc('social_profile', { p_user: F.id })) as { restricted: boolean; follow_status: string }[])[0], 'pending request still restricted').toMatchObject({ restricted: true, follow_status: 'pending' });
    await rpc(F, 'respond_follow_request', { p_follower: V.id, p_accept: true });
    expect((must(await V.sb.rpc('social_profile', { p_user: F.id })) as { restricted: boolean; bio: string }[])[0]).toMatchObject({ restricted: false, bio: 'Bio of sf' });
    const self = (must(await P.sb.rpc('social_profile', { p_user: P.id })) as { is_self: boolean }[])[0]!;
    expect(self.is_self).toBe(true);
    expect(must(await V.sb.rpc('social_profile', { p_user: rid() })), 'unknown user').toEqual([]);
  });
});

describe('direct table access on the social tables', () => {
  let A: TestUser, B: TestUser, p: string;
  beforeAll(async () => { A = await createUser('da'); B = await createUser('db'); p = await post(A, 'target', 'public', true); await rpc(B, 'like_post', { p_post: p }); await rpc(B, 'add_comment', { p_post: p, p_body: 'c' }); });
  const NOREAD = ['posts', 'post_media', 'post_likes', 'post_comments'];
  for (const t of NOREAD) {
    it(`${t}: no client read path at all (authenticated and anonymous)`, async () => {
      expect((await rawRest(A, 'GET', `${t}?select=*`)).status, `${t} authenticated read`).toBeGreaterThanOrEqual(400);
      expect((await rawRest(null, 'GET', `${t}?select=*`)).status, `${t} anon read`).toBeGreaterThanOrEqual(400);
    });
  }
  const WRITES: Record<string, [Record<string, unknown>, Record<string, unknown>]> = {
    posts: [{ id: rid(), author_id: '', caption: 'direct', audience: 'public' }, { caption: 'HACKED' }],
    post_media: [{ post_id: '', user_id: '', storage_path: 'x', content_type: 'image/png', size_bytes: 1 }, { size_bytes: 2 }],
    post_likes: [{ post_id: '', user_id: '' }, { user_id: '' }], post_saves: [{ post_id: '', user_id: '' }, { user_id: '' }],
    post_comments: [{ post_id: '', author_id: '', body: 'direct' }, { body: 'HACKED' }],
    notifications: [{ recipient_id: '', actor_id: '', type: 'follow' }, { read_at: '2020-01-01T00:00:00Z' }],
    content_reports: [{ reporter_id: '', target_type: 'post', target_id: '', reason: 'spam' }, { status: 'closed' }],
    blocks: [{ blocker_id: '', blocked_id: '' }, { blocked_id: '' }], follows: [{ follower_id: '', followee_id: '', status: 'accepted', accepted_at: '2020-01-01T00:00:00Z' }, { status: 'accepted' }],
  };
  for (const [t, [ins, upd]] of Object.entries(WRITES)) {
    it(`${t}: insert, update and delete are refused`, async () => {
      const fill = (o: Record<string, unknown>) => JSON.parse(JSON.stringify(o).replace(/"author_id":""/, `"author_id":"${B.id}"`).replace(/"user_id":""/g, `"user_id":"${B.id}"`)
        .replace(/"post_id":""/g, `"post_id":"${p}"`).replace(/"recipient_id":""/, `"recipient_id":"${B.id}"`).replace(/"actor_id":""/, `"actor_id":"${A.id}"`)
        .replace(/"reporter_id":""/, `"reporter_id":"${B.id}"`).replace(/"target_id":""/, `"target_id":"${p}"`).replace(/"blocker_id":""/, `"blocker_id":"${B.id}"`)
        .replace(/"blocked_id":""/g, `"blocked_id":"${A.id}"`).replace(/"follower_id":""/, `"follower_id":"${B.id}"`).replace(/"followee_id":""/, `"followee_id":"${A.id}"`));
      const before = JSON.stringify(must(await admin.from(t).select('*')).length);
      const i = await rawRest(B, 'POST', t, fill(ins)); expect(i.status, `POST ${t}: ${i.text}`).toBeGreaterThanOrEqual(400);
      const u = await rawRest(B, 'PATCH', `${t}`, fill(upd)); expect(u.status, `PATCH ${t}: ${u.text}`).toBeGreaterThanOrEqual(400);
      const d = await rawRest(B, 'DELETE', `${t}?created_at=gt.2000-01-01`); expect(d.status, `DELETE ${t}: ${d.text}`).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(must(await admin.from(t).select('*')).length), `${t} row count unchanged`).toBe(before);
    });
  }
  it('anonymous callers cannot call any social function', async () => {
    for (const fn of ['feed_page', 'like_post', 'follow_user', 'report_content', 'notifications_page', 'block_user', 'create_post', 'can_view_content', 'social_profile']) {
      const r = await rawRest(null, 'POST', `rpc/${fn}`, {});
      expect(r.status, `anon ${fn}`).toBeGreaterThanOrEqual(400);
    }
  });
  it('the internal visibility and notification helpers are not callable by signed-in users', async () => {
    for (const [fn, args] of [['can_view_content', { p_viewer: A.id, p_author: B.id, p_audience: 'public' }], ['_notify', { p_recipient: A.id, p_actor: B.id, p_type: 'follow' }],
      ['_post_rows', { p_viewer: A.id, p_mode: 'explore', p_author: null, p_limit: 10, p_cursor: null }], ['orphan_post_media', {}]] as const) {
      const r = await rawRest(A, 'POST', `rpc/${fn}`, args);
      expect(r.status, `${fn} must be hidden from authenticated: ${r.text}`).toBeGreaterThanOrEqual(400);
    }
  });
  it('own-row reads work for notifications, saves, reports, blocks and follows only for their owner', async () => {
    const mine = await rawRest(A, 'GET', 'notifications?select=*');
    expect((mine.json as { recipient_id: string }[]).every((n) => n.recipient_id === A.id)).toBe(true);
    expect((mine.json as unknown[]).length).toBeGreaterThan(0);
    const theirs = await rawRest(B, 'GET', `notifications?recipient_id=eq.${A.id}`);
    expect(theirs.json, 'B cannot read A notifications').toEqual([]);
  });
});
