import {
  SOCIAL_RULES, SocialFailure, clampPageSize, effectiveAudience, safeCursor, takePage, validateCaption, validateComment, validateReport,
  type BlockedPerson, type CommentView, type FeedKind, type FollowStatus, type MediaRef, type NotificationType, type NotificationView,
  type Page, type PeopleKind, type PersonRow, type PostView, type ReportReason, type ReportTarget, type SocialApi, type SocialCounts,
  type SocialErrorCode, type SocialProfileView,
} from './social';
import type { Audience } from './types';
import { photoDataUri } from './art';

/* In-memory implementation used by MOCKED tests and the dev-only UI harness. It mirrors the documented rules, but it is
   not evidence about the database: only the integration suite (tests/integration) proves the real rules. */

export interface FakeUser { id: string; name: string; visibility: Audience; bio: string; age: number; completed: boolean }
interface FPost { id: string; authorId: string; caption: string; audience: Audience; seq: number; media: boolean }
interface FComment { id: string; postId: string; authorId: string; body: string; seq: number }
interface FNote { id: string; recipient: string; actor: string; type: NotificationType; postId: string | null; commentId: string | null; seq: number; read: boolean }

const BASE = Date.UTC(2026, 0, 1);
const stamp = (seq: number) => new Date(BASE + seq * 1000).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
const cursorOf = (seq: number, id: string) => `${stamp(seq)}|${id}`;
const seqOf = (cursor: string) => (Date.parse(cursor.split('|')[0]!.replace(/(\d{3})000Z$/, '$1Z')) - BASE) / 1000;
const key = (a: string, b: string) => `${a}>${b}`;

export class FakeSocialWorld {
  users = new Map<string, FakeUser>();
  posts: FPost[] = [];
  likes = new Set<string>(); saves = new Set<string>();
  comments: FComment[] = [];
  follows = new Map<string, FollowStatus>();
  blocks = new Set<string>();
  notes: FNote[] = [];
  reports: { reporter: string; type: ReportTarget; target: string; reason: string; details: string }[] = [];
  private tick = 1;
  next() { return this.tick++; }

  /** JSON-safe copy of the whole world, so the dev-only UI harness can survive a page refresh. */
  snapshot() {
    return { users: [...this.users.values()], posts: this.posts, likes: [...this.likes], saves: [...this.saves], comments: this.comments,
      follows: [...this.follows], blocks: [...this.blocks], notes: this.notes, reports: this.reports, tick: this.tick };
  }
  restore(s: ReturnType<FakeSocialWorld['snapshot']>) {
    this.users = new Map(s.users.map((u) => [u.id, u])); this.posts = s.posts; this.likes = new Set(s.likes); this.saves = new Set(s.saves);
    this.comments = s.comments; this.follows = new Map(s.follows); this.blocks = new Set(s.blocks); this.notes = s.notes; this.reports = s.reports; this.tick = s.tick;
  }

  addUser(u: Partial<FakeUser> & { name: string }): FakeUser {
    const user: FakeUser = { id: crypto.randomUUID(), visibility: 'public', bio: `About ${u.name}`, age: 30, completed: true, ...u };
    this.users.set(user.id, user);
    return user;
  }
  blockedBetween(a: string, b: string) { return this.blocks.has(key(a, b)) || this.blocks.has(key(b, a)); }
  /** The one place the fake decides visibility, mirroring public.can_view_content(). */
  canView(viewer: string, author: string, audience: Audience): boolean {
    if (viewer === author) return true;
    const v = this.users.get(viewer), a = this.users.get(author);
    if (!v || !a || !v.completed || !a.completed || this.blockedBetween(viewer, author)) return false;
    return effectiveAudience(audience, a.visibility) === 'public' || this.follows.get(key(viewer, author)) === 'accepted';
  }
  /** Test helper: adds a post as another (or any) author without going through an API object. */
  addPost(authorId: string, caption: string, audience: Audience = 'public', media = false): string {
    const id = crypto.randomUUID(); this.posts.push({ id, authorId, caption, audience, seq: this.next(), media }); return id;
  }
  notify(recipient: string, actor: string, type: NotificationType, postId: string | null = null, commentId: string | null = null) {
    if (recipient === actor || this.blockedBetween(recipient, actor)) return;
    const dup = this.notes.some((n) => n.recipient === recipient && n.actor === actor && n.type === type &&
      (type === 'like' ? n.postId === postId : type === 'comment' ? n.commentId === commentId : true));
    if (!dup) this.notes.push({ id: crypto.randomUUID(), recipient, actor, type, postId, commentId, seq: this.next(), read: false });
  }
}

const err = (code: SocialErrorCode, msg: string) => new SocialFailure(code, msg);

export class FakeSocialApi implements SocialApi {
  calls: string[] = [];
  latencyMs = 0;
  private failing: { code: SocialErrorCode; times: number; only?: string } | null = null;
  constructor(public world: FakeSocialWorld, public me: string) {}
  failNext(code: SocialErrorCode, times = 1, only?: string) { this.failing = { code, times, only }; }
  private async gate(name: string) {
    this.calls.push(name);
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.failing && this.failing.times > 0 && (!this.failing.only || this.failing.only === name)) {
      this.failing.times--; throw err(this.failing.code, `fake ${this.failing.code}`);
    }
  }
  private name(id: string) { return this.world.users.get(id)?.name ?? 'Someone'; }
  private visiblePost(id: string): FPost {
    const p = this.world.posts.find((x) => x.id === id);
    if (!p || !this.world.canView(this.me, p.authorId, p.audience)) throw err('not_found', 'That post isn’t available.');
    return p;
  }
  private count(set: Set<string>, postId: string) { return [...set].filter((k) => k.startsWith(`${postId}|`) && !this.world.blockedBetween(this.me, k.split('|')[1]!)).length; }
  private view(p: FPost): PostView {
    const w = this.world;
    return {
      id: p.id, authorId: p.authorId, authorName: this.name(p.authorId), authorPhotoPath: `${p.authorId}/avatar.jpg`, caption: p.caption, audience: p.audience,
      createdAt: stamp(p.seq), media: p.media ? { path: `${p.authorId}/${p.id}/image.jpg`, contentType: 'image/jpeg' } : null,
      likeCount: this.count(w.likes, p.id),
      commentCount: w.comments.filter((c) => c.postId === p.id && !w.blockedBetween(this.me, c.authorId)).length,
      likedByMe: w.likes.has(`${p.id}|${this.me}`), savedByMe: w.saves.has(`${p.id}|${this.me}`), isMine: p.authorId === this.me, cursor: cursorOf(p.seq, p.id),
    };
  }
  private page(rows: FPost[], cursor: string | null | undefined): Page<PostView> {
    const c = safeCursor(cursor);
    if (cursor && !c) throw err('invalid_cursor', 'That page link is no longer valid.');
    const sorted = rows.filter((p) => this.world.canView(this.me, p.authorId, p.audience)).sort((a, b) => b.seq - a.seq);
    const after = c ? sorted.filter((p) => p.seq < seqOf(c)) : sorted;
    return takePage(after.slice(0, clampPageSize(SOCIAL_RULES.pageSize) + 1).map((p) => this.view(p)));
  }

  async feed(kind: FeedKind, cursor?: string | null) {
    await this.gate('feed');
    const w = this.world;
    const rows = w.posts.filter((p) => kind === 'explore'
      ? p.audience === 'public' && w.users.get(p.authorId)?.visibility === 'public'
      : p.authorId === this.me || w.follows.get(key(this.me, p.authorId)) === 'accepted');
    return this.page(rows, cursor);
  }
  async authorPosts(authorId: string, cursor?: string | null) { await this.gate('authorPosts'); return this.page(this.world.posts.filter((p) => p.authorId === authorId), cursor); }
  async savedPosts(cursor?: string | null) { await this.gate('savedPosts'); return this.page(this.world.posts.filter((p) => this.world.saves.has(`${p.id}|${this.me}`)), cursor); }
  async createPost(i: { id: string; caption: string; audience: Audience; image: Blob | null }) {
    await this.gate('createPost');
    const bad = validateCaption(i.caption, !!i.image);
    if (bad) throw err('invalid', bad);
    const dup = this.world.posts.find((p) => p.id === i.id);
    if (dup) { if (dup.authorId === this.me) return; throw err('invalid', 'That post was already created.'); }
    this.world.posts.push({ id: i.id, authorId: this.me, caption: i.caption.trim(), audience: i.audience, seq: this.world.next(), media: !!i.image });
  }
  async deletePost(id: string) {
    await this.gate('deletePost');
    const w = this.world; const p = w.posts.find((x) => x.id === id && x.authorId === this.me);
    if (!p) throw err('not_found', 'That post no longer exists.');
    w.posts = w.posts.filter((x) => x.id !== id);
    w.comments = w.comments.filter((c) => c.postId !== id);
    for (const s of [w.likes, w.saves]) for (const k of [...s]) if (k.startsWith(`${id}|`)) s.delete(k);
    w.notes = w.notes.filter((n) => n.postId !== id);
  }
  async setAudience(id: string, audience: Audience) {
    await this.gate('setAudience');
    const p = this.world.posts.find((x) => x.id === id && x.authorId === this.me);
    if (!p) throw err('not_found', 'That post no longer exists.');
    p.audience = audience;
  }
  async like(id: string) {
    await this.gate('like'); const p = this.visiblePost(id);
    if (!this.world.likes.has(`${id}|${this.me}`)) { this.world.likes.add(`${id}|${this.me}`); this.world.notify(p.authorId, this.me, 'like', id); }
    return { liked: true, likeCount: this.count(this.world.likes, id) };
  }
  async unlike(id: string) {
    await this.gate('unlike');
    this.world.likes.delete(`${id}|${this.me}`);
    this.world.notes = this.world.notes.filter((n) => !(n.type === 'like' && n.postId === id && n.actor === this.me));
    return { liked: false, likeCount: this.count(this.world.likes, id) };
  }
  async save(id: string) { await this.gate('save'); this.visiblePost(id); this.world.saves.add(`${id}|${this.me}`); }
  async unsave(id: string) { await this.gate('unsave'); this.world.saves.delete(`${id}|${this.me}`); }
  async comments(postId: string, cursor?: string | null): Promise<Page<CommentView>> {
    await this.gate('comments'); const p = this.visiblePost(postId);
    const c = safeCursor(cursor);
    if (cursor && !c) throw err('invalid_cursor', 'That page link is no longer valid.');
    const after = c ? seqOf(c) : -Infinity;
    const rows = this.world.comments.filter((x) => x.postId === postId && !this.world.blockedBetween(this.me, x.authorId) && x.seq > after)
      .sort((a, b) => a.seq - b.seq).slice(0, SOCIAL_RULES.pageSize + 1)
      .map((x): CommentView => ({ id: x.id, authorId: x.authorId, authorName: this.name(x.authorId), body: x.body, createdAt: stamp(x.seq), canDelete: x.authorId === this.me || p.authorId === this.me, cursor: cursorOf(x.seq, x.id) }));
    return takePage(rows);
  }
  async addComment(postId: string, body: string) {
    await this.gate('addComment'); const p = this.visiblePost(postId);
    const bad = validateComment(body); if (bad) throw err('invalid', bad);
    const c: FComment = { id: crypto.randomUUID(), postId, authorId: this.me, body: body.trim(), seq: this.world.next() };
    this.world.comments.push(c); this.world.notify(p.authorId, this.me, 'comment', postId, c.id);
    return c.id;
  }
  async deleteComment(id: string) {
    await this.gate('deleteComment');
    const c = this.world.comments.find((x) => x.id === id); const p = c && this.world.posts.find((x) => x.id === c.postId);
    if (!c || !p || (c.authorId !== this.me && p.authorId !== this.me)) throw err('not_found', 'That comment no longer exists.');
    this.world.comments = this.world.comments.filter((x) => x.id !== id);
    this.world.notes = this.world.notes.filter((n) => n.commentId !== id);
  }
  async follow(userId: string): Promise<FollowStatus> {
    await this.gate('follow'); const w = this.world; const t = w.users.get(userId);
    if (userId === this.me) throw err('invalid', 'You can’t follow yourself.');
    if (!t || !t.completed || w.blockedBetween(this.me, userId)) throw err('not_found', 'That person isn’t available.');
    const cur = w.follows.get(key(this.me, userId)); if (cur) return cur;
    const st: FollowStatus = t.visibility === 'public' ? 'accepted' : 'pending';
    w.follows.set(key(this.me, userId), st); w.notify(userId, this.me, st === 'accepted' ? 'follow' : 'follow_request');
    return st;
  }
  async unfollow(userId: string) {
    await this.gate('unfollow');
    this.world.follows.delete(key(this.me, userId));
    this.world.notes = this.world.notes.filter((n) => !(n.recipient === userId && n.actor === this.me && (n.type === 'follow' || n.type === 'follow_request')));
  }
  async respondToRequest(followerId: string, accept: boolean) {
    await this.gate('respondToRequest'); const w = this.world;
    if (w.follows.get(key(followerId, this.me)) !== 'pending') throw err('not_found', 'That request is no longer there.');
    const req = w.notes.find((n) => n.recipient === this.me && n.actor === followerId && n.type === 'follow_request');
    if (accept) { w.follows.set(key(followerId, this.me), 'accepted'); if (req) req.read = true; w.notify(followerId, this.me, 'follow_accepted'); }
    else { w.follows.delete(key(followerId, this.me)); w.notes = w.notes.filter((n) => n !== req); }
  }
  async removeFollower(followerId: string) {
    await this.gate('removeFollower');
    if (this.world.follows.get(key(followerId, this.me)) === 'accepted') this.world.follows.delete(key(followerId, this.me));
  }
  async people(kind: PeopleKind, cursor?: string | null): Promise<Page<PersonRow>> {
    await this.gate('people'); void cursor;
    const rows: PersonRow[] = [];
    this.world.follows.forEach((status, k) => {
      const [a, b] = k.split('>') as [string, string];
      const other = kind === 'following' ? (a === this.me ? b : null) : b === this.me && (kind === 'followers' ? status === 'accepted' : status === 'pending') ? a : null;
      if (other && !this.world.blockedBetween(this.me, other)) rows.push({ userId: other, displayName: this.name(other), photoPath: `${other}/avatar.jpg`, status, createdAt: stamp(0), cursor: cursorOf(0, other) });
    });
    return { items: rows.sort((x, y) => x.displayName.localeCompare(y.displayName)), next: null };
  }
  async counts(): Promise<SocialCounts> {
    await this.gate('counts'); let following = 0, followers = 0, requests = 0;
    this.world.follows.forEach((s, k) => {
      const [a, b] = k.split('>');
      if (a === this.me && s === 'accepted') following++;
      if (b === this.me) { if (s === 'accepted') followers++; else requests++; }
    });
    return { following, followers, requests };
  }
  async profile(userId: string): Promise<SocialProfileView | null> {
    await this.gate('profile'); const w = this.world; const u = w.users.get(userId);
    if (!u || !u.completed || w.blockedBetween(this.me, userId)) return null;
    const full = w.canView(this.me, userId, 'public');
    const acc = (pred: (a: string, b: string) => boolean) => [...w.follows].filter(([k, s]) => s === 'accepted' && pred(...(k.split('>') as [string, string]))).length;
    return {
      userId, displayName: u.name, pronouns: full ? '' : null, bio: full ? u.bio : null, areaLabel: full ? 'Lisbon' : null, age: full ? u.age : null,
      photoPath: full ? `${userId}/avatar.jpg` : null, restricted: !full, isSelf: userId === this.me,
      followStatus: w.follows.get(key(this.me, userId)) ?? null, followsMeStatus: w.follows.get(key(userId, this.me)) ?? null,
      followerCount: full ? acc((_a, b) => b === userId) : null, followingCount: full ? acc((a) => a === userId) : null,
      postCount: full ? w.posts.filter((p) => p.authorId === userId && w.canView(this.me, userId, p.audience)).length : null,
    };
  }
  async block(userId: string) {
    await this.gate('block'); const w = this.world;
    if (userId === this.me) throw err('invalid', 'You can’t block yourself.');
    w.blocks.add(key(this.me, userId)); w.follows.delete(key(this.me, userId)); w.follows.delete(key(userId, this.me));
    w.notes = w.notes.filter((n) => !((n.recipient === this.me && n.actor === userId) || (n.recipient === userId && n.actor === this.me)));
  }
  async unblock(userId: string) { await this.gate('unblock'); this.world.blocks.delete(key(this.me, userId)); }
  async blocked(): Promise<BlockedPerson[]> {
    await this.gate('blocked');
    return [...this.world.blocks].filter((k) => k.startsWith(`${this.me}>`)).map((k) => k.split('>')[1]!).map((id) => ({ userId: id, displayName: this.name(id), createdAt: stamp(0) }));
  }
  async notifications(cursor?: string | null): Promise<Page<NotificationView>> {
    await this.gate('notifications'); void cursor;
    const items = this.world.notes.filter((n) => n.recipient === this.me && !this.world.blockedBetween(this.me, n.actor)).sort((a, b) => b.seq - a.seq)
      .map((n): NotificationView => ({ id: n.id, type: n.type, actorId: n.actor, actorName: this.name(n.actor), postId: n.postId, commentId: n.commentId, createdAt: stamp(n.seq), read: n.read,
        followStatus: this.world.follows.get(key(n.actor, this.me)) ?? null, cursor: cursorOf(n.seq, n.id) }));
    return { items, next: null };
  }
  async unreadCount() { await this.gate('unreadCount'); return this.world.notes.filter((n) => n.recipient === this.me && !n.read && !this.world.blockedBetween(this.me, n.actor)).length; }
  async markRead(ids?: string[]) { await this.gate('markRead'); for (const n of this.world.notes) if (n.recipient === this.me && (!ids || ids.includes(n.id))) n.read = true; }
  async report(target: ReportTarget, targetId: string, reason: ReportReason, details: string) {
    await this.gate('report');
    const bad = validateReport(reason, details); if (bad) throw err('invalid', bad);
    if (this.world.reports.filter((r) => r.reporter === this.me).length >= 10) throw err('rate_limited', 'You’ve sent a lot of reports. Try again later.');
    if (target === 'post') this.visiblePost(targetId);
    this.world.reports.push({ reporter: this.me, type: target, target: targetId, reason, details: details.trim() });
  }
  async mediaUrls(refs: MediaRef[]) {
    await this.gate('mediaUrls');
    const out = new Map<string, string>();
    for (const r of refs) { let h = 0; for (const c of r.path) h = (h * 31 + c.charCodeAt(0)) >>> 0; out.set(r.path, photoDataUri(h % 90)); }
    return out;
  }
}
