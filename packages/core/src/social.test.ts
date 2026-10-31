// UNIT tests for pure Phase 3 logic. These prove the helpers; they say nothing about database behaviour.
import { describe, expect, it } from 'vitest';
import {
  SubmitGuard, appendUnique, audienceCopy, charCount, clampPageSize, effectiveAudience, followAction, isCursor, mergeNotifications, notificationText,
  postedAgo, postsReducer, safeCursor, takePage, unreadLabel, validateCaption, validateComment, validateReport, emptyList,
  type ListState, type NotificationView, type PostView,
} from './index';

const C = (n: number) => `2026-01-01T00:00:${String(n).padStart(2, '0')}.000000Z|aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const post = (n: number, o: Partial<PostView> = {}): PostView => ({
  id: `p${n}`, authorId: 'a', authorName: 'A', authorPhotoPath: null, caption: 'c', audience: 'public', createdAt: '2026-01-01T00:00:00.000000Z', media: null,
  likeCount: 2, commentCount: 0, likedByMe: false, savedByMe: false, isMine: false, commentsAllowed: true, cursor: C(n), ...o,
});
const list = (...ps: PostView[]): ListState<PostView> => ({ items: ps, next: null, loaded: true });

describe('validation', () => {
  it('caption: 2200 characters, text or image required, emoji count once', () => {
    expect(validateCaption('x'.repeat(2200), false)).toBeNull();
    expect(validateCaption('x'.repeat(2201), false)).toMatch(/2200/);
    expect(validateCaption('   ', false)).toMatch(/Write something/);
    expect(validateCaption('', true)).toBeNull();
    expect(charCount('👩‍👩‍👧')).toBeGreaterThan(1);
    expect(charCount('😀😀')).toBe(2);
    expect(validateCaption('😀'.repeat(2200), false)).toBeNull();
  });
  it('comment: 1 to 300 after trimming', () => {
    expect(validateComment('  ')).not.toBeNull();
    expect(validateComment(' hi ')).toBeNull();
    expect(validateComment('x'.repeat(300))).toBeNull();
    expect(validateComment('x'.repeat(301))).toMatch(/300/);
  });
  it('report: reason must be from the list; details up to 500', () => {
    expect(validateReport('spam', '')).toBeNull();
    expect(validateReport('because', '')).not.toBeNull();
    expect(validateReport('other', 'x'.repeat(501))).toMatch(/500/);
  });
});

describe('audience helpers', () => {
  it('a followers-only profile makes every post followers-only (mirrors the database rule)', () => {
    expect(effectiveAudience('public', 'public')).toBe('public');
    expect(effectiveAudience('public', 'followers')).toBe('followers');
    expect(effectiveAudience('followers', 'public')).toBe('followers');
  });
  it('composer copy is honest about reach and warns when a public choice is overridden', () => {
    expect(audienceCopy('public', 'public').detail).toMatch(/Explore/);
    const o = audienceCopy('public', 'followers');
    expect(o.title).toMatch(/followers-only/i); expect(o.warning).toMatch(/Settings/); expect(o.detail).toMatch(/won’t appear in Explore/);
    expect(audienceCopy('followers', 'public').warning).toMatch(/screenshot/i);
  });
});

describe('cursors and pages', () => {
  it('accepts only well-formed cursors and drops anything else', () => {
    expect(isCursor(C(1))).toBe(true);
    for (const bad of ['', 'garbage', "x'; drop table posts;--", '2026-01-01T00:00:00Z|nope', null, undefined, 5]) expect(isCursor(bad as never), String(bad)).toBe(false);
    expect(safeCursor(C(2))).toBe(C(2)); expect(safeCursor('nope')).toBeNull(); expect(safeCursor(undefined)).toBeNull();
  });
  it('page size is clamped to 10..20', () => {
    expect([clampPageSize(1), clampPageSize(15), clampPageSize(99), clampPageSize(undefined), clampPageSize(NaN)]).toEqual([10, 15, 20, 15, 15]);
  });
  it('takePage trims the lookahead row and exposes the cursor of the last visible row', () => {
    const rows = Array.from({ length: 16 }, (_, i) => post(i));
    const p = takePage(rows);
    expect(p.items).toHaveLength(15); expect(p.next).toBe(rows[14]!.cursor);
    const last = takePage(rows.slice(0, 15));
    expect(last.items).toHaveLength(15); expect(last.next).toBeNull();
    expect(takePage([]).next).toBeNull();
  });
  it('appendUnique skips rows that an insert shifted into the next window', () => {
    expect(appendUnique([post(1), post(2)], [post(2), post(3)]).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('optimistic reducers', () => {
  it('like: flips at once, reconciles with the server count, and rolls back on failure', () => {
    let s = list(post(1, { likeCount: 2 }));
    s = postsReducer(s, { type: 'like/start', id: 'p1' });
    expect(s.items[0]).toMatchObject({ likedByMe: true, likeCount: 3 });
    s = postsReducer(s, { type: 'like/fail', id: 'p1' });
    expect(s.items[0]).toMatchObject({ likedByMe: false, likeCount: 2 }); expect(s.items[0]!.rollback).toBeUndefined();
    s = postsReducer(s, { type: 'like/start', id: 'p1' });
    s = postsReducer(s, { type: 'like/ok', id: 'p1', liked: true, likeCount: 9 }); // others liked meanwhile
    expect(s.items[0]).toMatchObject({ likedByMe: true, likeCount: 9 }); expect(s.items[0]!.rollback).toBeUndefined();
  });
  it('like: a second click while a request is in flight is ignored', () => {
    let s = list(post(1));
    s = postsReducer(s, { type: 'like/start', id: 'p1' });
    const once = s.items[0]!;
    s = postsReducer(s, { type: 'like/start', id: 'p1' });
    expect(s.items[0]).toEqual(once);
  });
  it('unlike never drives the count below zero', () => {
    const s = postsReducer(list(post(1, { likedByMe: true, likeCount: 0 })), { type: 'like/start', id: 'p1' });
    expect(s.items[0]!.likeCount).toBe(0);
  });
  it('save: toggles, rolls back, and keeps like state untouched', () => {
    let s = list(post(1));
    s = postsReducer(s, { type: 'like/start', id: 'p1' });
    s = postsReducer(s, { type: 'save/start', id: 'p1' });
    expect(s.items[0]!.savedByMe).toBe(true);
    s = postsReducer(s, { type: 'save/fail', id: 'p1' });
    expect(s.items[0]).toMatchObject({ savedByMe: false, likedByMe: true });
    expect(s.items[0]!.rollback?.like).toBeDefined();
  });
  it('comment counts, audience changes, removal, prepend and append are pure and immutable', () => {
    const a = list(post(1), post(2)); const before = JSON.stringify(a);
    let s = postsReducer(a, { type: 'comments/delta', id: 'p1', delta: 1 });
    s = postsReducer(s, { type: 'comments/delta', id: 'p2', delta: -5 });
    expect(s.items.map((p) => p.commentCount)).toEqual([1, 0]);
    s = postsReducer(s, { type: 'audience', id: 'p2', audience: 'followers' });
    expect(s.items[1]!.audience).toBe('followers');
    s = postsReducer(s, { type: 'prepend', post: post(9) });
    expect(s.items.map((p) => p.id)).toEqual(['p9', 'p1', 'p2']);
    s = postsReducer(s, { type: 'prepend', post: post(9) });
    expect(s.items).toHaveLength(3);
    s = postsReducer(s, { type: 'remove', id: 'p1' });
    expect(s.items.map((p) => p.id)).toEqual(['p9', 'p2']);
    expect(JSON.stringify(a)).toBe(before);
    s = postsReducer(emptyList(), { type: 'replace', page: { items: [post(1)], next: C(1) } });
    s = postsReducer(s, { type: 'append', page: { items: [post(1), post(2)], next: null } });
    expect(s).toMatchObject({ loaded: true, next: null }); expect(s.items.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('SubmitGuard', () => {
  it('runs one request per key at a time and shares its result', async () => {
    const g = new SubmitGuard(); let calls = 0;
    const slow = () => new Promise<number>((r) => setTimeout(() => r(++calls), 20));
    const [a, b] = await Promise.all([g.run('post', slow), g.run('post', slow)]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
    expect(g.isBusy('post')).toBe(false);
    expect(await g.run('post', slow)).toBe(2);
  });
  it('releases the key after a failure so the user can retry', async () => {
    const g = new SubmitGuard();
    await expect(g.run('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await g.run('k', async () => 'ok')).toBe('ok');
  });
});

describe('notifications', () => {
  const n = (id: string, type: NotificationView['type'], o: Partial<NotificationView> = {}): NotificationView => ({
    id, type, actorId: 'x', actorName: 'Xia', postId: type === 'like' || type === 'comment' ? 'p1' : null, commentId: type === 'comment' ? id : null,
    createdAt: `2026-01-01T00:00:0${id}.000000Z`, read: false, followStatus: null, cursor: C(Number(id)), ...o,
  });
  it('merges pages by id, newest first, with updated rows winning', () => {
    const m = mergeNotifications([n('1', 'follow'), n('2', 'comment')], [n('2', 'comment', { read: true }), n('3', 'follow_accepted')]);
    expect(m.map((x) => x.id)).toEqual(['3', '2', '1']); expect(m[1]!.read).toBe(true);
  });
  it('the same person liking the same post never shows twice', () => {
    expect(mergeNotifications([n('1', 'like')], [n('2', 'like')]).map((x) => x.id)).toEqual(['2']);
    expect(mergeNotifications([n('1', 'like')], [n('2', 'like', { actorId: 'y' })])).toHaveLength(2);
    expect(mergeNotifications([n('1', 'comment')], [n('2', 'comment')])).toHaveLength(2);
  });
  it('texts and badge label', () => {
    expect(notificationText(n('1', 'follow_request'))).toBe('Xia asked to follow you');
    expect(notificationText(n('1', 'follow_request', { followStatus: 'accepted' }))).toBe('You accepted Xia’s follow request');
    expect(notificationText(n('1', 'like'))).toBe('Xia liked your post');
    expect([unreadLabel(0), unreadLabel(7), unreadLabel(100), unreadLabel(-3)]).toEqual(['0', '7', '99+', '0']);
  });
});

describe('relationship button and time', () => {
  it('chooses the follow action from the relationship', () => {
    const p = { isSelf: false, followStatus: null, restricted: false } as const;
    expect(followAction(p)).toBe('follow'); expect(followAction(p, 'followers')).toBe('request'); expect(followAction({ ...p, restricted: true })).toBe('request');
    expect(followAction({ ...p, followStatus: 'accepted' })).toBe('unfollow'); expect(followAction({ ...p, followStatus: 'pending' })).toBe('cancel');
    expect(followAction({ ...p, isSelf: true })).toBe('none');
  });
  it('postedAgo is short and never negative', () => {
    const now = Date.parse('2026-01-02T00:00:00Z');
    expect([postedAgo('2026-01-02T00:00:30Z', now), postedAgo('2026-01-01T23:50:00Z', now), postedAgo('2026-01-01T20:00:00Z', now), postedAgo('2025-12-31T00:00:00Z', now), postedAgo('2026-01-03T00:00:00Z', now)])
      .toEqual(['just now', '10m', '4h', '2d', 'just now']);
  });
});
