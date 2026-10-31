// INTEGRATION (Phase 3): notifications, reports, blocks, post-media storage across audiences, cascades.
import { beforeAll, describe, expect, it } from 'vitest';
import { PNG, URL_, admin, bigJpeg, createUser, ids, mediaPathOf, must, post, rawRest, rid, rpc, rpcFails, type FeedRow, type TestUser } from './harness';

interface Note { id: string; type: string; actor_id: string; actor_name: string; post_id: string | null; comment_id: string | null; read: boolean; follow_status: string | null }
const notes = (u: TestUser, limit = 20, cursor: string | null = null) => rpc<(Note & { page_cursor: string })[]>(u, 'notifications_page', { p_limit: limit, p_cursor: cursor });
const unread = (u: TestUser) => rpc<number>(u, 'unread_notification_count');
const signed = async (u: TestUser, path: string, bucket = 'post-media') => (await u.sb.storage.from(bucket).createSignedUrl(path, 60));
const posts = (v: TestUser, a: string) => rpc<FeedRow[]>(v, 'profile_posts_page', { p_author: a, p_limit: 20, p_cursor: null });

describe('notifications', () => {
  let O: TestUser, L: TestUser, M: TestUser, p: string;
  beforeAll(async () => { [O, L, M] = await Promise.all([createUser('no'), createUser('nl'), createUser('nm')]); p = await post(O, 'notify me'); });

  it('a like creates one notification for the author; self-likes create none', async () => {
    await rpc(O, 'like_post', { p_post: p });
    expect(await notes(O)).toHaveLength(0);
    await rpc(L, 'like_post', { p_post: p });
    const n = await notes(O);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ type: 'like', actor_id: L.id, actor_name: 'nl', post_id: p, read: false });
    expect(await unread(O)).toBe(1);
  });
  it('like spam (like/unlike cycles and double clicks) never produces more than one row', async () => {
    for (let i = 0; i < 6; i++) { await rpc(M, 'like_post', { p_post: p }); await rpc(M, 'like_post', { p_post: p }); await rpc(M, 'unlike_post', { p_post: p }); }
    await rpc(M, 'like_post', { p_post: p });
    expect(must(await admin.from('notifications').select('id').eq('recipient_id', O.id).eq('actor_id', M.id).eq('type', 'like')).length).toBe(1);
  });
  it('comments notify the author (not the commenter on their own post), one per comment', async () => {
    const before = (await notes(O)).length;
    await rpc(O, 'add_comment', { p_post: p, p_body: 'self comment' });
    expect((await notes(O)).length, 'no self-notification').toBe(before);
    await rpc(L, 'add_comment', { p_post: p, p_body: 'one' }); await rpc(L, 'add_comment', { p_post: p, p_body: 'two' });
    expect((await notes(O)).filter((n) => n.type === 'comment')).toHaveLength(2);
  });
  it('mark read: specific ids, then all; other people ids are ignored', async () => {
    const all = await notes(O);
    expect(await unread(O)).toBe(all.length);
    expect(await rpc<number>(L, 'mark_notifications_read', { p_ids: all.map((n) => n.id) }), 'someone else cannot mark my notifications').toBe(0);
    expect(await unread(O)).toBe(all.length);
    expect(await rpc<number>(O, 'mark_notifications_read', { p_ids: [all[0]!.id] })).toBe(1);
    expect(await unread(O)).toBe(all.length - 1);
    await rpc(O, 'mark_notifications_read');
    expect(await unread(O)).toBe(0);
    expect((await notes(O)).every((n) => n.read)).toBe(true);
  });
  it('recipient-only: nobody else can read them, and clients cannot create or edit them', async () => {
    expect((await rawRest(L, 'GET', `notifications?recipient_id=eq.${O.id}`)).json).toEqual([]);
    expect((await rawRest(null, 'GET', 'notifications?select=*')).status).toBeGreaterThanOrEqual(400);
    const forge = await rawRest(L, 'POST', 'notifications', { recipient_id: O.id, actor_id: L.id, type: 'like', post_id: p });
    expect(forge.status, forge.text).toBeGreaterThanOrEqual(400);
    const edit = await rawRest(O, 'PATCH', `notifications?recipient_id=eq.${O.id}`, { read_at: null });
    expect(edit.status).toBeGreaterThanOrEqual(400);
  });
  it('un-liking removes the like notification; liking again recreates exactly one', async () => {
    await rpc(L, 'unlike_post', { p_post: p });
    expect((await notes(O)).filter((n) => n.type === 'like' && n.actor_id === L.id)).toHaveLength(0);
    await rpc(L, 'like_post', { p_post: p });
    expect((await notes(O)).filter((n) => n.type === 'like' && n.actor_id === L.id)).toHaveLength(1);
  });
  it('follow, follow_request and follow_accepted notifications carry the right type and state', async () => {
    const F = await createUser('nf', { visibility: 'followers' });
    await rpc(L, 'follow_user', { p_user: F.id });
    expect(await notes(F)).toMatchObject([{ type: 'follow_request', actor_id: L.id, follow_status: 'pending' }]);
    await rpc(F, 'respond_follow_request', { p_follower: L.id, p_accept: true });
    expect((await notes(F))[0]).toMatchObject({ type: 'follow_request', read: true });
    expect(await notes(L)).toMatchObject([{ type: 'follow_accepted', actor_id: F.id }]);
  });
  it('is keyset paginated', async () => {
    const many = await createUser('nmany'); const actors = await Promise.all(Array.from({ length: 12 }, (_, i) => createUser(`na${i}`)));
    for (const a of actors) await rpc(a, 'follow_user', { p_user: many.id });
    const first = await notes(many, 10); expect(first).toHaveLength(11);
    const rest = await notes(many, 10, first[9]!.page_cursor); expect(rest).toHaveLength(2);
    expect(new Set([...first.slice(0, 10), ...rest].map((n) => n.id)).size).toBe(12);
  });
});

describe('blocks', () => {
  let A: TestUser, B: TestUser, C: TestUser, pa: string, pb: string;
  beforeAll(async () => {
    [A, B, C] = await Promise.all([createUser('ba'), createUser('bb'), createUser('bc')]);
    pa = await post(A, 'a post'); pb = await post(B, 'b post');
    await rpc(A, 'follow_user', { p_user: B.id }); await rpc(B, 'follow_user', { p_user: A.id });
    await rpc(B, 'like_post', { p_post: pa }); await rpc(B, 'add_comment', { p_post: pa, p_body: 'from b' }); await rpc(C, 'add_comment', { p_post: pa, p_body: 'from c' });
  });
  it('blocking removes follows both ways and deletes notifications between the pair', async () => {
    expect((await notes(A)).length).toBeGreaterThan(0);
    await rpc(A, 'block_user', { p_user: B.id });
    expect(must(await admin.from('follows').select('status').or(`and(follower_id.eq.${A.id},followee_id.eq.${B.id}),and(follower_id.eq.${B.id},followee_id.eq.${A.id})`))).toHaveLength(0);
    expect((await notes(A)).filter((n) => n.actor_id === B.id)).toHaveLength(0);
    await rpc(A, 'block_user', { p_user: B.id }); // idempotent
    expect(must(await admin.from('blocks').select('blocked_id').eq('blocker_id', A.id))).toHaveLength(1);
  });
  it('is enforced in feed, profiles, comments, follows, notifications and reports — in both directions', async () => {
    for (const [viewer, other, theirPost] of [[A, B, pb], [B, A, pa]] as const) {
      expect(ids(await posts(viewer, other.id)), 'profile posts').toHaveLength(0);
      for (const f of ['explore', 'following'] as const) {
        expect(ids(await rpc<FeedRow[]>(viewer, 'feed_page', { p_feed: f, p_limit: 20 })), `${f} feed`).not.toContain(theirPost);
      }
      expect(must(await viewer.sb.rpc('social_profile', { p_user: other.id })), 'social profile').toEqual([]);
      await rpcFails(viewer, 'follow_user', { p_user: other.id }, 'LOVOKI_NOT_FOUND');
      await rpcFails(viewer, 'like_post', { p_post: theirPost }, 'LOVOKI_NOT_FOUND');
      await rpcFails(viewer, 'add_comment', { p_post: theirPost, p_body: 'x' }, 'LOVOKI_NOT_FOUND');
      await rpcFails(viewer, 'save_post', { p_post: theirPost }, 'LOVOKI_NOT_FOUND');
      await rpcFails(viewer, 'report_content', { p_type: 'post', p_target: theirPost, p_reason: 'spam' }, 'LOVOKI_NOT_FOUND');
      await rpcFails(viewer, 'report_content', { p_type: 'profile', p_target: other.id, p_reason: 'spam' }, 'LOVOKI_NOT_FOUND');
    }
  });
  it('a blocked person’s comments vanish from the blocker’s thread and counts, but others still see them', async () => {
    const asA = await rpc<{ body: string }[]>(A, 'comments_page', { p_post: pa });
    expect(asA.map((c) => c.body)).toEqual(['from c']);
    expect((await posts(A, A.id)).find((r) => r.post_id === pa)!.comment_count, 'count excludes blocked commenter').toBe(1);
    expect((await posts(A, A.id)).find((r) => r.post_id === pa)!.like_count, 'like count excludes blocked liker').toBe(0);
    const asC = await rpc<{ body: string }[]>(C, 'comments_page', { p_post: pa });
    expect(asC.map((c) => c.body)).toEqual(['from b', 'from c']);
  });
  it('notifications from a blocked actor are never created', async () => {
    const before = (await notes(A)).length;
    await rpc(B, 'like_post', { p_post: pa }).catch(() => undefined);
    expect((await notes(A)).length).toBe(before);
  });
  it('list_blocks and unblock; unblocking restores visibility but not follows', async () => {
    expect(await rpc<{ user_id: string; display_name: string }[]>(A, 'list_blocks')).toMatchObject([{ user_id: B.id, display_name: 'bb' }]);
    expect(await rpc<unknown[]>(B, 'list_blocks'), 'the blocked person cannot see that they are blocked').toHaveLength(0);
    await rpc(A, 'unblock_user', { p_user: B.id });
    expect(ids(await posts(A, B.id))).toContain(pb);
    expect(must(await admin.from('follows').select('status').eq('follower_id', A.id).eq('followee_id', B.id))).toHaveLength(0);
    await rpcFails(A, 'block_user', { p_user: A.id }, 'LOVOKI_INVALID');
    await rpcFails(A, 'block_user', { p_user: rid() }, 'LOVOKI_NOT_FOUND');
    expect((await rawRest(A, 'POST', 'blocks', { blocker_id: A.id, blocked_id: C.id })).status, 'no direct block writes').toBeGreaterThanOrEqual(400);
  });
  it('a block also hides profile photos', async () => {
    const X = await createUser('bx'); const Y = await createUser('by');
    const path = must(await X.sb.from('profile_photos').select('storage_path'))[0]!.storage_path as string;
    expect((await signed(Y, path, 'profile-photos')).error).toBeNull();
    await rpc(X, 'block_user', { p_user: Y.id });
    expect((await signed(Y, path, 'profile-photos')).error, 'blocked viewer is denied the photo').not.toBeNull();
  });
});

describe('content reports', () => {
  let R: TestUser, T: TestUser, O: TestUser, p: string;
  beforeAll(async () => { [R, T, O] = await Promise.all([createUser('rr'), createUser('rt'), createUser('ro')]); p = await post(T, 'reportable'); });
  it('saves a report for review, is idempotent per target, and returns the same id', async () => {
    const id = await rpc<string>(R, 'report_content', { p_type: 'post', p_target: p, p_reason: 'spam', p_details: '  looks like an ad  ' });
    expect(await rpc<string>(R, 'report_content', { p_type: 'post', p_target: p, p_reason: 'scam' }), 'a second report of the same target is not duplicated').toBe(id);
    const row = must(await admin.from('content_reports').select('*').eq('id', id).single());
    expect(row).toMatchObject({ reporter_id: R.id, target_type: 'post', target_id: p, reason: 'spam', details: 'looks like an ad', status: 'open' });
  });
  it('reporters read only their own reports and cannot edit them', async () => {
    expect(must(await R.sb.from('content_reports').select('*'))).toHaveLength(1);
    expect(must(await O.sb.from('content_reports').select('*')), 'another user sees none').toHaveLength(0);
    expect((await rawRest(T, 'GET', `content_reports?target_id=eq.${p}`)).json, 'the reported person cannot see who reported them').toEqual([]);
    const edit = await rawRest(R, 'PATCH', 'content_reports', { status: 'closed' }); expect(edit.status).toBeGreaterThanOrEqual(400);
    const forge = await rawRest(R, 'POST', 'content_reports', { reporter_id: R.id, target_type: 'post', target_id: rid(), reason: 'spam' }); expect(forge.status).toBeGreaterThanOrEqual(400);
    expect(must(await admin.from('content_reports').select('status').eq('reporter_id', R.id)).every((r) => r.status === 'open')).toBe(true);
  });
  it('comments and profiles can be reported; yourself and invalid input cannot', async () => {
    const c = await rpc<string>(T, 'add_comment', { p_post: p, p_body: 'a comment' });
    await rpc(R, 'report_content', { p_type: 'comment', p_target: c, p_reason: 'harassment' });
    await rpc(R, 'report_content', { p_type: 'profile', p_target: T.id, p_reason: 'impersonation' });
    await rpcFails(T, 'report_content', { p_type: 'post', p_target: p, p_reason: 'spam' }, 'LOVOKI_NOT_FOUND');
    await rpcFails(T, 'report_content', { p_type: 'profile', p_target: T.id, p_reason: 'spam' }, 'LOVOKI_NOT_FOUND');
    await rpcFails(R, 'report_content', { p_type: 'post', p_target: rid(), p_reason: 'spam' }, 'LOVOKI_NOT_FOUND');
    await rpcFails(R, 'report_content', { p_type: 'user', p_target: T.id, p_reason: 'spam' }, 'LOVOKI_INVALID');
    await rpcFails(R, 'report_content', { p_type: 'profile', p_target: O.id, p_reason: 'because' }, 'LOVOKI_INVALID');
    await rpcFails(R, 'report_content', { p_type: 'profile', p_target: O.id, p_reason: 'other', p_details: 'x'.repeat(501) }, 'LOVOKI_INVALID');
  });
  it('is throttled to 10 new reports per hour per reporter', async () => {
    const S = await createUser('rs'); const targets = await Promise.all(Array.from({ length: 11 }, (_, i) => createUser(`rtg${i}`)));
    for (let i = 0; i < 10; i++) await rpc(S, 'report_content', { p_type: 'profile', p_target: targets[i]!.id, p_reason: 'spam' });
    await rpcFails(S, 'report_content', { p_type: 'profile', p_target: targets[10]!.id, p_reason: 'spam' }, 'LOVOKI_RATE_LIMITED');
    await rpc(S, 'report_content', { p_type: 'profile', p_target: targets[0]!.id, p_reason: 'spam' }); // repeats are idempotent, not throttled
    expect(must(await admin.from('content_reports').select('id').eq('reporter_id', S.id))).toHaveLength(10);
    await rpc(R, 'report_content', { p_type: 'profile', p_target: targets[10]!.id, p_reason: 'spam' }); // other reporters are unaffected
  });
  it('a report outlives the content it describes', async () => {
    const q = await post(T, 'to be deleted'); const id = await rpc<string>(R, 'report_content', { p_type: 'post', p_target: q, p_reason: 'hate' });
    await rpc(T, 'delete_post', { p_post: q });
    expect(must(await admin.from('content_reports').select('id').eq('id', id))).toHaveLength(1);
  });
});

describe('post-media storage', () => {
  let O: TestUser, other: TestUser, follower: TestUser, pending: TestUser, stranger: TestUser, blocked: TestUser;
  let pubPost: string, folPost: string, pubPath: string, folPath: string;
  beforeAll(async () => {
    [O, other, follower, pending, stranger, blocked] = await Promise.all([createUser('mo'), createUser('mother'), createUser('mfol'), createUser('mpend'), createUser('mstr'), createUser('mblk')]);
    await rpc(O, 'save_privacy', { p_area_label: 'Lisbon', p_social_visibility: 'followers', p_dating_discoverable: false });
    pubPost = await post(O, 'image post', 'public', true); folPost = await post(O, 'followers image post', 'followers', true);
    pubPath = (await mediaPathOf(pubPost))!; folPath = (await mediaPathOf(folPost))!;
    await rpc(follower, 'follow_user', { p_user: O.id }); await rpc(O, 'respond_follow_request', { p_follower: follower.id, p_accept: true });
    await rpc(pending, 'follow_user', { p_user: O.id });
    await rpc(blocked, 'follow_user', { p_user: O.id }); await rpc(O, 'respond_follow_request', { p_follower: blocked.id, p_accept: true });
    await rpc(O, 'block_user', { p_user: blocked.id });
  });

  it('upload rules: own folder, <uid>/<post-uuid>/<uuid>.<ext>, no overwrite, type and size limits', async () => {
    const b = other.sb.storage.from('post-media');
    const pid = rid();
    expect((await b.upload(`${O.id}/${pid}/${rid()}.png`, PNG, { contentType: 'image/png' })).error, 'other user folder').not.toBeNull();
    for (const bad of [`${other.id}/${rid()}.png`, `${other.id}/${pid}/name.png`, `${other.id}/${pid}/${rid()}.gif`, `${other.id}/${pid}/x/${rid()}.png`, `${other.id}/not-a-uuid/${rid()}.png`]) {
      expect((await b.upload(bad, PNG, { contentType: 'image/png' })).error, `bad name ${bad}`).not.toBeNull();
    }
    const ok = `${other.id}/${pid}/${rid()}.png`;
    expect((await b.upload(ok, PNG, { contentType: 'image/png' })).error).toBeNull();
    expect((await b.upload(ok, PNG, { contentType: 'image/png', upsert: true })).error, 'overwrite via upsert').not.toBeNull();
    expect((await b.upload(ok, PNG, { contentType: 'image/png' })).error, 'duplicate name').not.toBeNull();
    expect((await b.upload(`${other.id}/${pid}/${rid()}.jpg`, bigJpeg(5 * 1024 * 1024 + 1), { contentType: 'image/jpeg' })).error, 'over 5 MB').not.toBeNull();
    expect((await b.upload(`${other.id}/${pid}/${rid()}.png`, new TextEncoder().encode('hi'), { contentType: 'text/plain' })).error, 'text/plain').not.toBeNull();
    expect((await b.upload(`${other.id}/${pid}/${rid()}.png`, PNG, { contentType: 'image/svg+xml' })).error, 'svg').not.toBeNull();
  });
  it('per-user object cap (60) holds for sequential uploads without policy recursion', async () => {
    const C = await createUser('mcap', { complete: false }); const pid = rid();
    let ok = 0, last = '';
    for (let i = 0; i < 63; i++) {
      const r = await C.sb.storage.from('post-media').upload(`${C.id}/${pid}/${rid()}.png`, PNG, { contentType: 'image/png' });
      if (!r.error) ok++; else last = r.error.message;
    }
    expect(ok, `accepted out of 63 (last error: ${last})`).toBe(60);
    expect(last).not.toMatch(/recursion/i);
  });
  it('read policy follows the post audience: public post readable by strangers, followers post only by accepted followers and the owner', async () => {
    for (const [name, u, mayReadFol] of [['owner', O, true], ['accepted follower', follower, true], ['pending requester', pending, false], ['stranger', stranger, false], ['blocked follower', blocked, false]] as const) {
      expect((await signed(u, folPath)).error === null, `${name}: followers-post media`).toBe(mayReadFol);
    }
    // the public post sits on a followers-only profile, which makes it followers-only as well (profile audience wins)
    expect((await signed(stranger, pubPath)).error, 'stranger vs public post on followers-only profile').not.toBeNull();
    expect((await signed(follower, pubPath)).error).toBeNull();
    const P = await createUser('mpub'); const pp = await post(P, 'open', 'public', true); const path = (await mediaPathOf(pp))!;
    const s = await signed(stranger, path); expect(s.error, 'stranger vs public post on public profile').toBeNull();
    const bytes = await (await fetch(s.data!.signedUrl.startsWith('http') ? s.data!.signedUrl : URL_ + s.data!.signedUrl)).arrayBuffer();
    expect(bytes.byteLength, 'the signed URL really serves the image').toBe(PNG.byteLength);
    expect((await signed(await createUser('mincomplete', { complete: false }), path)).error, 'viewer without a completed profile').not.toBeNull();
    await rpc(P, 'block_user', { p_user: stranger.id });
    expect((await signed(stranger, path)).error, 'blocked viewer').not.toBeNull();
    expect((await rawRest(null, 'GET', `../storage/v1/object/post-media/${path}`)).status, 'anonymous direct object URL').toBeGreaterThanOrEqual(400);
  });
  it('changing the audience changes media access immediately', async () => {
    const P = await createUser('mchg'); const v = await createUser('mchgv');
    const pp = await post(P, 'switch', 'public', true); const path = (await mediaPathOf(pp))!;
    expect((await signed(v, path)).error).toBeNull();
    await rpc(P, 'set_post_audience', { p_post: pp, p_audience: 'followers' });
    expect((await signed(v, path)).error, 'after narrowing').not.toBeNull();
    await rpc(v, 'follow_user', { p_user: P.id }); // public profile: accepted
    expect((await signed(v, path)).error, 'accepted follower').toBeNull();
  });
  it('unregistered uploads (failed post creation) are readable only by their owner', async () => {
    const path = `${other.id}/${rid()}/${rid()}.png`;
    expect((await other.sb.storage.from('post-media').upload(path, PNG, { contentType: 'image/png' })).error).toBeNull();
    expect((await signed(other, path)).error).toBeNull();
    expect((await signed(stranger, path)).error).not.toBeNull();
  });
  it('only the owner can delete an object', async () => {
    await stranger.sb.storage.from('post-media').remove([folPath]);
    expect((await admin.storage.from('post-media').download(folPath)).error, 'object still exists').toBeNull();
  });
  it('create_post validates the media path, the stored object and the content', async () => {
    const id = rid(); const good = `${other.id}/${id}/${rid()}.png`;
    await other.sb.storage.from('post-media').upload(good, PNG, { contentType: 'image/png' });
    await rpcFails(other, 'create_post', { p_post_id: rid(), p_caption: 'x', p_audience: 'public', p_media_path: good }, 'LOVOKI_INVALID'); // path names another post id
    await rpcFails(O, 'create_post', { p_post_id: id, p_caption: 'x', p_audience: 'public', p_media_path: good }, 'LOVOKI_INVALID'); // path owned by someone else
    await rpcFails(other, 'create_post', { p_post_id: rid(), p_caption: 'x', p_audience: 'public', p_media_path: `${other.id}/${id}/${rid()}.png` }, 'LOVOKI_INVALID');
    const ghost = rid();
    await rpcFails(other, 'create_post', { p_post_id: ghost, p_caption: 'x', p_audience: 'public', p_media_path: `${other.id}/${ghost}/${rid()}.png` }, 'LOVOKI_PHOTO_MISSING');
    expect(must(await admin.from('posts').select('id').eq('id', ghost)), 'failed create left no post behind').toHaveLength(0);
    await rpc(other, 'create_post', { p_post_id: id, p_caption: '', p_audience: 'public', p_media_path: good }); // image-only post is fine
    const row = must(await admin.from('post_media').select('content_type,size_bytes').eq('post_id', id).single());
    expect(row).toEqual({ content_type: 'image/png', size_bytes: PNG.byteLength });
    await rpcFails(other, 'create_post', { p_post_id: id, p_caption: 'again', p_audience: 'public' }, 'LOVOKI_INVALID'); // duplicate id
    await rpcFails(other, 'create_post', { p_post_id: rid(), p_caption: 'x'.repeat(2201), p_audience: 'public' }, 'LOVOKI_INVALID');
    await rpcFails(other, 'create_post', { p_post_id: rid(), p_caption: '   ', p_audience: 'public' }, 'LOVOKI_INVALID');
    await rpcFails(other, 'create_post', { p_post_id: rid(), p_caption: 'ok', p_audience: 'friends' }, 'LOVOKI_INVALID');
    await rpc(other, 'create_post', { p_post_id: rid(), p_caption: 'x'.repeat(2200), p_audience: 'public' });
    const N = await createUser('mnew', { complete: false });
    await rpcFails(N, 'create_post', { p_post_id: rid(), p_caption: 'hi', p_audience: 'public' }, 'LOVOKI_ONBOARDING_INCOMPLETE');
  });
  it('the orphan sweep helper lists unreferenced objects and is operator-only', async () => {
    const path = `${other.id}/${rid()}/${rid()}.png`;
    await other.sb.storage.from('post-media').upload(path, PNG, { contentType: 'image/png' });
    const listed = must(await admin.rpc('orphan_post_media', { p_older_than: '0 seconds' })) as string[];
    expect(listed).toContain(path);
    expect(listed, 'registered media is never listed').not.toContain(pubPath);
    expect((await other.sb.rpc('orphan_post_media', { p_older_than: '0 seconds' })).error, 'clients cannot run the sweep helper').not.toBeNull();
  });
});

describe('cascades', () => {
  it('deleting a post removes its media, comments, likes, saves and notifications; the owner removes the file', async () => {
    const O = await createUser('xo'); const V = await createUser('xv'); const W = await createUser('xw');
    const p = await post(O, 'doomed', 'public', true); const path = (await mediaPathOf(p))!;
    await rpc(V, 'like_post', { p_post: p }); await rpc(V, 'save_post', { p_post: p }); const c = await rpc<string>(V, 'add_comment', { p_post: p, p_body: 'hi' });
    await rpc(W, 'like_post', { p_post: p });
    const q = await post(O, 'survivor');
    await rpc(V, 'like_post', { p_post: q });
    expect(must(await admin.from('notifications').select('id').eq('post_id', p)).length).toBe(3);
    await rpcFails(V, 'delete_post', { p_post: p }, 'LOVOKI_NOT_FOUND');
    const paths = await rpc<string[]>(O, 'delete_post', { p_post: p });
    expect(paths).toEqual([path]);
    for (const [t, col] of [['post_media', 'post_id'], ['post_likes', 'post_id'], ['post_saves', 'post_id'], ['post_comments', 'post_id'], ['notifications', 'post_id']] as const) {
      expect(must(await admin.from(t).select('*').eq(col, p)), `${t} rows for the deleted post`).toHaveLength(0);
    }
    expect(must(await admin.from('post_comments').select('id').eq('id', c))).toHaveLength(0);
    expect(must(await admin.from('notifications').select('id').eq('post_id', q)), 'other posts keep their notifications').toHaveLength(1);
    expect((await O.sb.storage.from('post-media').remove(paths)).error).toBeNull();
    expect((await admin.storage.from('post-media').download(path)).error, 'object gone from storage').not.toBeNull();
    await rpcFails(V, 'like_post', { p_post: p }, 'LOVOKI_NOT_FOUND');
  });
  it('deleting an account removes everything the person made', async () => {
    const O = await createUser('xdel'); const V = await createUser('xdelv');
    const p = await post(O, 'bye'); await rpc(V, 'like_post', { p_post: p }); await rpc(V, 'follow_user', { p_user: O.id }); await rpc(V, 'block_user', { p_user: O.id });
    must(await admin.auth.admin.deleteUser(O.id) as never);
    for (const [t, col] of [['posts', 'author_id'], ['follows', 'followee_id'], ['blocks', 'blocked_id'], ['notifications', 'recipient_id'], ['profiles', 'user_id']] as const) {
      expect(must(await admin.from(t).select('*').eq(col, O.id)), `${t}`).toHaveLength(0);
    }
  });
});
