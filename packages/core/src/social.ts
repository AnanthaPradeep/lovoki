/* Phase 3 social domain: types, rules, validation, audience copy, cursors, optimistic reducers.
   Pure functions only. The database enforces every rule here again; these exist so the UI can explain and respond fast. */

import type { Audience } from './types';
import type { AvatarCrop } from './dating';
import type { VisibleDetails } from './profile';

export type FollowStatus = 'pending' | 'accepted';
export type FeedKind = 'following' | 'explore';
export type MediaBucket = 'post-media' | 'profile-photos';

export const SOCIAL_RULES = {
  captionMax: 2200,
  commentMax: 300,
  reportDetailsMax: 500,
  pageSize: 15,
  minPageSize: 10,
  maxPageSize: 20,
  /** Same limits as profile photos: the post-media bucket accepts JPEG/PNG/WebP up to 5 MB. */
  maxImagesPerPost: 1,
} as const;

export interface MediaRef { bucket: MediaBucket; path: string }
export interface PostMedia { path: string; contentType: string }

export interface PostView {
  id: string;
  authorId: string;
  authorName: string;
  authorPhotoPath: string | null;
  caption: string;
  audience: Audience;
  createdAt: string;
  media: PostMedia | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  savedByMe: boolean;
  isMine: boolean;
  /** False when the author limits comments (followers only, or nobody) and you are not allowed. */
  commentsAllowed: boolean;
  /** Opaque keyset cursor pointing at this row. */
  cursor: string;
  /** Values to restore if an optimistic change fails. Present only while a request is in flight. */
  rollback?: { like?: { liked: boolean; count: number }; save?: boolean };
}

export interface CommentView {
  id: string; authorId: string; authorName: string; body: string; createdAt: string; canDelete: boolean; cursor: string;
}

export type NotificationType = 'like' | 'comment' | 'follow' | 'follow_request' | 'follow_accepted' | 'match';
export interface NotificationView {
  id: string; type: NotificationType; actorId: string; actorName: string; postId: string | null; commentId: string | null;
  createdAt: string; read: boolean;
  /** For follow requests: the requester's current status toward you, so the row can show Accept/Decline or the result. */
  followStatus: FollowStatus | null; cursor: string;
}

export interface PersonRow { userId: string; displayName: string; photoPath: string | null; status: FollowStatus; createdAt: string; cursor: string }
export type PeopleKind = 'following' | 'followers' | 'requests';
export interface SocialCounts { following: number; followers: number; requests: number }

export interface SocialProfileView {
  userId: string; username: string | null; displayName: string; pronouns: string | null; bio: string | null; areaLabel: string | null; age: number | null;
  gender: string | null; genderCustom: string | null; photoPath: string | null; avatarCrop: AvatarCrop | null; interests: string[]; prompts: { question: string; answer: string }[];
  /** Only the optional fields this viewer may see. */
  details: VisibleDetails;
  /** True when the viewer may only see a name (followers-only profile, not an accepted follower). */
  restricted: boolean; isSelf: boolean;
  followStatus: FollowStatus | null; followsMeStatus: FollowStatus | null;
  followerCount: number | null; followingCount: number | null; postCount: number | null;
}

export interface BlockedPerson { userId: string; displayName: string; createdAt: string }
export interface Page<T> { items: T[]; next: string | null }

export type ReportTarget = 'post' | 'comment' | 'profile';
export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or ads' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate or abuse' },
  { value: 'sexual_content', label: 'Sexual or explicit content' },
  { value: 'self_harm', label: 'Self-harm' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'impersonation', label: 'Pretending to be someone else' },
  { value: 'underage', label: 'Looks under 18' },
  { value: 'other', label: 'Something else' },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]['value'];

export type SocialErrorCode = 'not_found' | 'rate_limited' | 'invalid' | 'invalid_cursor' | 'incomplete' | 'unauthorized' | 'network' | 'unknown';
export class SocialFailure extends Error {
  readonly code: SocialErrorCode;
  constructor(code: SocialErrorCode, message: string) { super(message); this.name = 'SocialFailure'; this.code = code; }
}

/** Social persistence port. Screens depend on this, never on the SDK. Implemented by SupabaseSocialApi and FakeSocialApi. */
export interface SocialApi {
  feed(kind: FeedKind, cursor?: string | null): Promise<Page<PostView>>;
  authorPosts(authorId: string, cursor?: string | null): Promise<Page<PostView>>;
  savedPosts(cursor?: string | null): Promise<Page<PostView>>;
  /** One post, or null when it doesn't exist or you may not see it (the same answer for both). */
  post(id: string): Promise<PostView | null>;
  /** `id` is chosen by the client so the media path can name the post before it exists. `image` is already processed. */
  createPost(input: { id: string; caption: string; audience: Audience; image: Blob | null }): Promise<void>;
  deletePost(id: string): Promise<void>;
  setAudience(id: string, audience: Audience): Promise<void>;
  like(id: string): Promise<{ liked: boolean; likeCount: number }>;
  unlike(id: string): Promise<{ liked: boolean; likeCount: number }>;
  save(id: string): Promise<void>;
  unsave(id: string): Promise<void>;
  comments(postId: string, cursor?: string | null): Promise<Page<CommentView>>;
  addComment(postId: string, body: string): Promise<string>;
  deleteComment(id: string): Promise<void>;
  follow(userId: string): Promise<FollowStatus>;
  unfollow(userId: string): Promise<void>;
  respondToRequest(followerId: string, accept: boolean): Promise<void>;
  removeFollower(followerId: string): Promise<void>;
  people(kind: PeopleKind, cursor?: string | null): Promise<Page<PersonRow>>;
  counts(): Promise<SocialCounts>;
  profile(userId: string): Promise<SocialProfileView | null>;
  /** Resolves /@handle to a person you may see, or null. */
  resolveUsername(handle: string): Promise<string | null>;
  block(userId: string): Promise<void>;
  unblock(userId: string): Promise<void>;
  blocked(): Promise<BlockedPerson[]>;
  notifications(cursor?: string | null): Promise<Page<NotificationView>>;
  unreadCount(): Promise<number>;
  markRead(ids?: string[]): Promise<void>;
  report(target: ReportTarget, targetId: string, reason: ReportReason, details: string): Promise<void>;
  /** Batched authorised URLs for private images, cached for the session and cleared on logout. Missing entries failed. */
  mediaUrls(refs: MediaRef[]): Promise<Map<string, string>>;
}

/* ---------------------------------------------------------------- validation */

const len = (s: string) => [...s].length; // code points, so an emoji counts once like a person expects

export function validateCaption(caption: string, hasImage: boolean): string | null {
  const t = caption.trim();
  if (len(caption) > SOCIAL_RULES.captionMax) return `Keep it to ${SOCIAL_RULES.captionMax} characters.`;
  if (!t && !hasImage) return 'Write something or add a photo.';
  return null;
}
export function validateComment(body: string): string | null {
  const t = body.trim();
  if (!t) return 'Write a comment first.';
  if (len(t) > SOCIAL_RULES.commentMax) return `Keep it to ${SOCIAL_RULES.commentMax} characters.`;
  return null;
}
export function validateReport(reason: string, details: string): string | null {
  if (!REPORT_REASONS.some((r) => r.value === reason)) return 'Choose a reason.';
  if (len(details.trim()) > SOCIAL_RULES.reportDetailsMax) return `Keep details to ${SOCIAL_RULES.reportDetailsMax} characters.`;
  return null;
}
export const charCount = len;

/* ------------------------------------------------------------------ audience */

/** A followers-only profile makes every post followers-only, whatever the post says. Mirrors can_view_content(). */
export function effectiveAudience(post: Audience, profileVisibility: Audience): Audience {
  return post === 'followers' || profileVisibility === 'followers' ? 'followers' : 'public';
}

export function audienceLabel(a: Audience) { return a === 'public' ? 'Public' : 'Followers'; }

/** Honest copy for the composer. Says who can see it, where it shows up, and what is not controlled. */
export function audienceCopy(selected: Audience, profileVisibility: Audience): { title: string; detail: string; warning: string | null } {
  const eff = effectiveAudience(selected, profileVisibility);
  if (eff === 'public') {
    return {
      title: 'Public',
      detail: 'Anyone on LOVOKI with a finished profile can see this, and it can appear in Explore. People you’ve blocked can’t.',
      warning: null,
    };
  }
  if (selected === 'public') {
    return {
      title: 'Followers (your profile is followers-only)',
      detail: 'Because your profile is followers-only, only people you’ve accepted as followers can see this. It won’t appear in Explore.',
      warning: 'Switch your profile to public in Settings if you want this post in Explore.',
    };
  }
  return {
    title: 'Followers',
    detail: 'Only people you’ve accepted as followers can see this. It won’t appear in Explore.',
    warning: 'Followers can still screenshot or share what they see. Choose who you accept accordingly.',
  };
}

/* -------------------------------------------------------------------- cursors */

export const CURSOR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isCursor = (s: unknown): s is string => typeof s === 'string' && CURSOR_RE.test(s);
/** Returns the cursor to send, or null for the first page. A cursor that does not look like one is dropped, never forwarded. */
export const safeCursor = (s: string | null | undefined): string | null => (isCursor(s) ? s : null);

export function clampPageSize(n: number | undefined | null): number {
  const v = Number.isFinite(n) ? Math.trunc(n as number) : SOCIAL_RULES.pageSize;
  return Math.min(SOCIAL_RULES.maxPageSize, Math.max(SOCIAL_RULES.minPageSize, v));
}

/** The database returns up to limit+1 rows. The extra row only signals that another page exists. */
export function takePage<T extends { cursor: string }>(rows: T[], limit: number = SOCIAL_RULES.pageSize): Page<T> {
  const size = clampPageSize(limit);
  const items = rows.slice(0, size);
  return { items, next: rows.length > size ? items[items.length - 1]!.cursor : null };
}

/* ---------------------------------------------------------------- list state */

export interface ListState<T> { items: T[]; next: string | null; loaded: boolean }
export const emptyList = <T,>(): ListState<T> => ({ items: [], next: null, loaded: false });

/** Appends a page. Rows already present (an insert shifted the window) are skipped, never duplicated. */
export function appendUnique<T extends { id: string }>(items: T[], page: T[]): T[] {
  const seen = new Set(items.map((i) => i.id));
  return [...items, ...page.filter((p) => !seen.has(p.id))];
}

/* ------------------------------------------------- optimistic post reducers */

export type PostAction =
  | { type: 'replace'; page: Page<PostView> }
  | { type: 'append'; page: Page<PostView> }
  | { type: 'prepend'; post: PostView }
  | { type: 'like/start'; id: string }
  | { type: 'like/ok'; id: string; liked: boolean; likeCount: number }
  | { type: 'like/fail'; id: string }
  | { type: 'save/start'; id: string }
  | { type: 'save/ok'; id: string }
  | { type: 'save/fail'; id: string }
  | { type: 'comments/delta'; id: string; delta: number }
  | { type: 'comments/set'; id: string; count: number }
  | { type: 'audience'; id: string; audience: Audience }
  | { type: 'remove'; id: string }
  | { type: 'removeAuthor'; authorId: string };

const patch = (s: ListState<PostView>, id: string, fn: (p: PostView) => PostView): ListState<PostView> =>
  ({ ...s, items: s.items.map((p) => (p.id === id ? fn(p) : p)) });

export function postsReducer(s: ListState<PostView>, a: PostAction): ListState<PostView> {
  switch (a.type) {
    case 'replace': return { items: a.page.items, next: a.page.next, loaded: true };
    case 'append': return { items: appendUnique(s.items, a.page.items), next: a.page.next, loaded: true };
    case 'prepend': return { ...s, items: appendUnique([a.post], s.items) };
    case 'like/start': return patch(s, a.id, (p) => {
      if (p.rollback?.like) return p; // a request is already in flight: ignore the second click (duplicate-submit protection)
      const liked = !p.likedByMe;
      return { ...p, likedByMe: liked, likeCount: Math.max(0, p.likeCount + (liked ? 1 : -1)), rollback: { ...p.rollback, like: { liked: p.likedByMe, count: p.likeCount } } };
    });
    case 'like/ok': return patch(s, a.id, (p) => ({ ...p, likedByMe: a.liked, likeCount: a.likeCount, rollback: dropKey(p.rollback, 'like') }));
    case 'like/fail': return patch(s, a.id, (p) => p.rollback?.like
      ? { ...p, likedByMe: p.rollback.like.liked, likeCount: p.rollback.like.count, rollback: dropKey(p.rollback, 'like') } : p);
    case 'save/start': return patch(s, a.id, (p) => p.rollback?.save !== undefined ? p : { ...p, savedByMe: !p.savedByMe, rollback: { ...p.rollback, save: p.savedByMe } });
    case 'save/ok': return patch(s, a.id, (p) => ({ ...p, rollback: dropKey(p.rollback, 'save') }));
    case 'save/fail': return patch(s, a.id, (p) => p.rollback?.save !== undefined ? { ...p, savedByMe: p.rollback.save, rollback: dropKey(p.rollback, 'save') } : p);
    case 'comments/delta': return patch(s, a.id, (p) => ({ ...p, commentCount: Math.max(0, p.commentCount + a.delta) }));
    case 'comments/set': return patch(s, a.id, (p) => ({ ...p, commentCount: Math.max(0, a.count) }));
    case 'audience': return patch(s, a.id, (p) => ({ ...p, audience: a.audience }));
    case 'remove': return { ...s, items: s.items.filter((p) => p.id !== a.id) };
    case 'removeAuthor': return { ...s, items: s.items.filter((p) => p.authorId !== a.authorId) };
  }
}

function dropKey(r: PostView['rollback'], key: 'like' | 'save'): PostView['rollback'] {
  if (!r) return undefined;
  const { [key]: _gone, ...rest } = r;
  return Object.keys(rest).length ? rest : undefined;
}

/** Runs one request per key at a time. A second call while the first is pending returns the first call's promise. */
export class SubmitGuard {
  private inflight = new Map<string, Promise<unknown>>();
  isBusy(key: string) { return this.inflight.has(key); }
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.inflight.get(key);
    if (hit) return hit as Promise<T>;
    const p = fn().finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, p);
    return p;
  }
}

/* ---------------------------------------------------------- notifications */

const byNewest = (a: NotificationView, b: NotificationView) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1);

/** Merges a page into the list: same id wins from the newer data, and the same (type, actor, post) like never shows twice. */
export function mergeNotifications(current: NotificationView[], incoming: NotificationView[]): NotificationView[] {
  const byId = new Map<string, NotificationView>();
  for (const n of [...current, ...incoming]) byId.set(n.id, n);
  const seenLike = new Set<string>();
  const out: NotificationView[] = [];
  for (const n of [...byId.values()].sort(byNewest)) {
    if (n.type === 'like') { const k = `${n.actorId}:${n.postId}`; if (seenLike.has(k)) continue; seenLike.add(k); }
    out.push(n);
  }
  return out;
}

export function notificationText(n: NotificationView): string {
  switch (n.type) {
    case 'like': return `${n.actorName} liked your post`;
    case 'comment': return `${n.actorName} commented on your post`;
    case 'follow': return `${n.actorName} started following you`;
    case 'follow_request': return n.followStatus === 'accepted' ? `You accepted ${n.actorName}’s follow request` : `${n.actorName} asked to follow you`;
    case 'follow_accepted': return `${n.actorName} accepted your follow request`;
    case 'match': return `You matched with ${n.actorName}`;
  }
}

export const unreadLabel = (n: number) => (n > 99 ? '99+' : String(Math.max(0, n)));

/* ------------------------------------------------------- relationship UI */

export type FollowAction = 'follow' | 'request' | 'unfollow' | 'cancel' | 'none';
/** What the profile's main button should do, from the viewer's current relationship and the profile's audience. */
export function followAction(p: Pick<SocialProfileView, 'isSelf' | 'followStatus' | 'restricted'>, profileVisibility: Audience | 'unknown' = 'unknown'): FollowAction {
  if (p.isSelf) return 'none';
  if (p.followStatus === 'accepted') return 'unfollow';
  if (p.followStatus === 'pending') return 'cancel';
  return p.restricted || profileVisibility === 'followers' ? 'request' : 'follow';
}
export const followActionLabel: Record<FollowAction, string> = { follow: 'Follow', request: 'Request to follow', unfollow: 'Following', cancel: 'Requested', none: '' };

export function postedAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
