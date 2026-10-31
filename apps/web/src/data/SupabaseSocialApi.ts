import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SIGNED_URL_CACHE_MS, SIGNED_URL_TTL_S, SOCIAL_RULES, SocialFailure, interestLabel, type PersonCard, type Relationship, type AvatarCrop, type VisibleDetails, extForType, safeCursor, sniffImageType, takePage, validateCaption, validateComment, validateReport, validateStoredPhoto,
  type Audience, type BlockedPerson, type CommentView, type FeedKind, type FollowStatus, type MediaRef, type NotificationType,
  type NotificationView, type Page, type PeopleKind, type PersonRow, type PostView, type ReportReason, type ReportTarget, type SocialApi,
  type SocialCounts, type SocialProfileView, type UserScope,
} from '@lovoki/core';
import type { Database } from './database.types';

type Fn = Database['public']['Functions'];
type Row<K extends keyof Fn> = Fn[K]['Returns'] extends (infer R)[] ? R : never;
interface DbError { message?: string; code?: string; status?: number }

/** Maps Postgres/PostgREST/Storage errors to safe messages. Never shows raw database text. */
export function toSocialFailure(e: unknown): SocialFailure {
  if (e instanceof SocialFailure) return e;
  const r: DbError = typeof e === 'object' && e ? (e as DbError) : {};
  const m = r.message ?? '';
  if (e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(m)) return new SocialFailure('network', 'Can’t reach LOVOKI. Check your connection and try again.');
  if (m.includes('LOVOKI_SAMPLE_TARGET')) return new SocialFailure('sample', 'This is sample content, so there is nobody to report.');
  if (m.includes('LOVOKI_NOT_FOUND')) return new SocialFailure('not_found', 'That isn’t available any more. It may have been removed or you may no longer have access.');
  if (m.includes('LOVOKI_RATE_LIMITED')) return new SocialFailure('rate_limited', 'You’ve sent a lot of reports recently. Try again in a while.');
  if (m.includes('LOVOKI_INVALID_CURSOR')) return new SocialFailure('invalid_cursor', 'That list is out of date. Reload to continue.');
  if (m.includes('LOVOKI_ONBOARDING_INCOMPLETE')) return new SocialFailure('incomplete', 'Finish setting up your profile first.');
  if (m.includes('LOVOKI_COMMENTS_OFF')) return new SocialFailure('invalid', 'The author has turned comments off for you.');
  if (m.includes('LOVOKI_PHOTO_MISSING')) return new SocialFailure('invalid', 'The image upload didn’t finish. Try again.');
  if (m.includes('LOVOKI_UNAUTHENTICATED') || r.status === 401 || r.code === 'PGRST301' || /jwt/i.test(m)) return new SocialFailure('unauthorized', 'Your session ended. Log in again.');
  if (m.includes('LOVOKI_INVALID') || /^2[23]/.test(r.code ?? '')) return new SocialFailure('invalid', 'That isn’t valid. Check it and try again.');
  return new SocialFailure('unknown', 'Something went wrong. Try again.');
}

type PostRowDb = Database['public']['CompositeTypes']['post_row'];
type CardRowDb = Database['public']['CompositeTypes']['person_card'];

export class SupabaseSocialApi implements SocialApi {
  /** `${bucket}:${path}` -> signed url. Cleared on logout through UserScope. */
  private urls = new Map<string, { url: string; exp: number }>();
  constructor(private sb: SupabaseClient, private userId: string, scope?: UserScope) {
    scope?.register('social-signed-urls', () => this.urls.clear());
  }

  private async rpc<K extends keyof Fn>(fn: K, args: Fn[K]['Args'] = {} as Fn[K]['Args']): Promise<Fn[K]['Returns']> {
    const { data, error } = await this.sb.rpc(fn as string, args as Record<string, unknown>);
    if (error) throw toSocialFailure(error);
    return data as Fn[K]['Returns'];
  }
  private cursor(c: string | null | undefined) {
    const safe = safeCursor(c);
    if (c && !safe) throw new SocialFailure('invalid_cursor', 'That list is out of date. Reload to continue.');
    return safe ?? undefined;
  }

  private toPost = (r: PostRowDb): PostView => ({
    id: r.post_id ?? '', authorId: r.author_id ?? '', authorName: r.author_name ?? 'Someone', authorUsername: r.author_username ?? null, authorPhotoPath: r.author_photo_path ?? null,
    authorBlurhash: r.author_blurhash ?? null, authorPrivate: r.author_private ?? false, isSample: r.is_sample ?? false, caption: r.caption ?? '',
    audience: (r.audience ?? 'public') as Audience, createdAt: r.created_at ?? '',
    media: r.media_path ? { path: r.media_path, contentType: r.media_type ?? 'image/jpeg', kind: r.media_kind === 'video' ? 'video' : 'image', thumbPath: r.thumb_path ?? null,
      width: r.media_width ?? null, height: r.media_height ?? null, blurhash: r.media_blurhash ?? null } : null,
    likeCount: r.like_count ?? 0, commentCount: r.comment_count ?? 0, likedByMe: r.liked_by_me ?? false, savedByMe: r.saved_by_me ?? false, isMine: r.is_mine ?? false,
    commentsAllowed: r.comments_allowed ?? true, cursor: r.page_cursor ?? '',
  });
  private toCard = (r: CardRowDb): PersonCard => ({
    userId: r.user_id ?? '', username: r.username ?? null, displayName: r.display_name ?? 'Someone', photoPath: r.photo_path ?? null, avatarBlurhash: r.avatar_blurhash ?? null,
    avatarCrop: (r.avatar_crop ?? null) as AvatarCrop | null, isPrivate: r.is_private ?? false, isSample: r.is_sample ?? false, followStatus: (r.follow_status ?? null) as FollowStatus | null, cursor: r.page_cursor ?? '',
  });
  private toProfile(r: Row<'social_profile'>): SocialProfileView {
    return {
      userId: r.user_id, username: r.username ?? null, displayName: r.display_name ?? 'Someone', gender: r.gender ?? null, genderCustom: r.gender_custom ?? null,
      avatarCrop: (r.avatar_crop ?? null) as AvatarCrop | null, avatarBlurhash: r.avatar_blurhash ?? null, isPrivate: r.is_private, isSample: r.is_sample, relationship: r.relationship as Relationship,
      interests: (r.interests ?? []).map((x: string) => interestLabel(x) ?? x), prompts: (Array.isArray(r.prompts) ? r.prompts : []) as { question: string; answer: string }[],
      details: (r.details ?? {}) as VisibleDetails, pronouns: r.pronouns ?? null, bio: r.bio ?? null, areaLabel: r.area_label ?? null, age: r.age ?? null,
      photoPath: r.photo_path ?? null, restricted: r.restricted, isSelf: r.is_self, followStatus: (r.follow_status ?? null) as FollowStatus | null,
      followsMeStatus: (r.follows_me_status ?? null) as FollowStatus | null, followerCount: r.follower_count ?? null, followingCount: r.following_count ?? null, postCount: r.post_count ?? null,
    };
  }

  async feed(kind: FeedKind, cursor?: string | null): Promise<Page<PostView>> {
    const rows = await this.rpc('feed_page', { p_feed: kind, p_limit: SOCIAL_RULES.pageSize, p_cursor: this.cursor(cursor) });
    return takePage(rows.map(this.toPost));
  }
  async authorPosts(authorId: string, cursor?: string | null) {
    return takePage((await this.rpc('profile_posts_page', { p_author: authorId, p_limit: SOCIAL_RULES.pageSize, p_cursor: this.cursor(cursor) })).map(this.toPost));
  }
  async post(id: string): Promise<PostView | null> {
    const r = (await this.rpc('post_page', { p_post: id }))[0];
    return r ? this.toPost(r as Row<'feed_page'>) : null;
  }
  async resolveUsername(handle: string) { return ((await this.rpc('resolve_username', { p_handle: handle })) as string | null) ?? null; }
  async profileByHandle(handle: string): Promise<SocialProfileView | null> {
    const r = (await this.rpc('get_social_profile', { p_handle: handle }))[0];
    return r ? this.toProfile(r) : null;
  }
  async profilePosts(handle: string, cursor?: string | null) {
    return takePage((await this.rpc('list_profile_posts', { p_handle: handle, p_limit: SOCIAL_RULES.pageSize, p_cursor: this.cursor(cursor) })).map(this.toPost));
  }
  async followersOf(handle: string, cursor?: string | null) {
    return takePage((await this.rpc('list_followers', { p_handle: handle, p_limit: 20, p_cursor: this.cursor(cursor) })).map(this.toCard), 20);
  }
  async followingOf(handle: string, cursor?: string | null) {
    return takePage((await this.rpc('list_following', { p_handle: handle, p_limit: 20, p_cursor: this.cursor(cursor) })).map(this.toCard), 20);
  }
  async search(query: string): Promise<PersonCard[]> {
    if ([...query.trim()].length < 2) return [];
    return (await this.rpc('search_profiles', { p_q: query.trim(), p_limit: 10 })).map(this.toCard);
  }
  async suggested(): Promise<PersonCard[]> { return (await this.rpc('suggested_people', { p_limit: 12 })).map(this.toCard); }
  async sampleFlags(ids: string[]) {
    if (!ids.length) return new Set<string>();
    return new Set((await this.rpc('sample_flags', { p_ids: ids })).filter((r: Row<'sample_flags'>) => r.is_sample).map((r: Row<'sample_flags'>) => r.user_id));
  }
  async savedPosts(cursor?: string | null) {
    return takePage((await this.rpc('saved_posts_page', { p_limit: SOCIAL_RULES.pageSize, p_cursor: this.cursor(cursor) })).map(this.toPost));
  }

  async createPost(i: { id: string; caption: string; audience: Audience; image: Blob | null; thumb?: Blob | null; size?: { width: number; height: number } | null; blurhash?: string | null }) {
    const bad = validateCaption(i.caption, !!i.image);
    if (bad) throw new SocialFailure('invalid', bad);
    let path: string | undefined; let thumbPath: string | undefined;
    if (i.image) {
      const stored = validateStoredPhoto(i.image);
      if (stored) throw new SocialFailure('invalid', stored);
      const sniffed = sniffImageType(new Uint8Array(await i.image.slice(0, 16).arrayBuffer()));
      if (!sniffed || sniffed !== i.image.type) throw new SocialFailure('invalid', 'That file isn’t a supported image.');
      path = `${this.userId}/${i.id}/${crypto.randomUUID()}.${extForType(sniffed)}`; // the client never chooses a free-form name
      const up = await this.sb.storage.from('post-media').upload(path, i.image, { contentType: sniffed, upsert: false, cacheControl: '3600' });
      if (up.error) throw toSocialFailure(up.error);
      if (i.thumb) {
        const thumbBad = validateStoredPhoto(i.thumb);
        if (thumbBad) { await this.sb.storage.from('post-media').remove([path]).catch(() => undefined); throw new SocialFailure('invalid', thumbBad); }
        thumbPath = `${this.userId}/${i.id}/${crypto.randomUUID()}.jpg`;
        const tu = await this.sb.storage.from('post-media').upload(thumbPath, i.thumb, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
        if (tu.error) { await this.sb.storage.from('post-media').remove([path]).catch(() => undefined); throw toSocialFailure(tu.error); }
      }
    }
    try {
      await this.rpc('create_post', { p_post_id: i.id, p_caption: i.caption, p_audience: i.audience, p_media_path: path, p_thumb_path: thumbPath, p_width: i.size?.width, p_height: i.size?.height, p_blurhash: i.blurhash ?? undefined });
    } catch (e) {
      const stale = [path, thumbPath].filter((x): x is string => !!x);
      if (stale.length) await this.sb.storage.from('post-media').remove(stale).catch(() => undefined); // do not leave unregistered objects behind
      throw e;
    }
  }
  async deletePost(id: string) {
    const paths = (await this.rpc('delete_post', { p_post: id })) as string[];
    paths.forEach((p) => this.urls.delete(`post-media:${p}`));
    if (paths.length) {
      const { error } = await this.sb.storage.from('post-media').remove(paths);
      if (error) console.warn('LOVOKI: post deleted but its image could not be removed; it will be swept.');
    }
  }
  async setAudience(id: string, audience: Audience) { await this.rpc('set_post_audience', { p_post: id, p_audience: audience }); }

  async like(id: string) { const r = (await this.rpc('like_post', { p_post: id }))[0]; return { liked: !!r?.liked, likeCount: r?.like_count ?? 0 }; }
  async unlike(id: string) { const r = (await this.rpc('unlike_post', { p_post: id }))?.[0]; return { liked: false, likeCount: r?.like_count ?? 0 }; }
  async save(id: string) { await this.rpc('save_post', { p_post: id }); }
  async unsave(id: string) { await this.rpc('unsave_post', { p_post: id }); }

  async comments(postId: string, cursor?: string | null): Promise<Page<CommentView>> {
    const rows = await this.rpc('comments_page', { p_post: postId, p_limit: SOCIAL_RULES.pageSize, p_cursor: this.cursor(cursor) });
    return takePage(rows.map((r: Row<'comments_page'>): CommentView => ({
      id: r.comment_id, authorId: r.author_id, authorName: r.author_name ?? 'Someone', body: r.body, createdAt: r.created_at, canDelete: r.can_delete, cursor: r.page_cursor })));
  }
  async addComment(postId: string, body: string) {
    const bad = validateComment(body);
    if (bad) throw new SocialFailure('invalid', bad);
    return this.rpc('add_comment', { p_post: postId, p_body: body });
  }
  async deleteComment(id: string) { await this.rpc('delete_comment', { p_comment: id }); }

  async follow(userId: string) { return (await this.rpc('follow_user', { p_user: userId })) as FollowStatus; }
  async unfollow(userId: string) { await this.rpc('unfollow_user', { p_user: userId }); }
  async respondToRequest(followerId: string, accept: boolean) { await this.rpc('respond_follow_request', { p_follower: followerId, p_accept: accept }); }
  async removeFollower(followerId: string) { await this.rpc('remove_follower', { p_follower: followerId }); }
  async people(kind: PeopleKind, cursor?: string | null): Promise<Page<PersonRow>> {
    const rows = await this.rpc('list_follows', { p_kind: kind, p_limit: 20, p_cursor: this.cursor(cursor) });
    return takePage(rows.map((r: Row<'list_follows'>): PersonRow => ({
      userId: r.user_id, displayName: r.display_name ?? 'Someone', photoPath: r.photo_path ?? null, status: r.status as FollowStatus, createdAt: r.created_at, cursor: r.page_cursor })), 20);
  }
  async counts(): Promise<SocialCounts> { const r = (await this.rpc('social_counts'))[0]; return { following: r?.following ?? 0, followers: r?.followers ?? 0, requests: r?.requests ?? 0 }; }
  async profile(userId: string): Promise<SocialProfileView | null> {
    const r = (await this.rpc('social_profile', { p_user: userId }))[0];
    return r ? this.toProfile(r) : null;
  }

  async block(userId: string) { await this.rpc('block_user', { p_user: userId }); }
  async unblock(userId: string) { await this.rpc('unblock_user', { p_user: userId }); }
  async blocked(): Promise<BlockedPerson[]> {
    return (await this.rpc('list_blocks')).map((r: Row<'list_blocks'>) => ({ userId: r.user_id, displayName: r.display_name, createdAt: r.created_at }));
  }

  async notifications(cursor?: string | null): Promise<Page<NotificationView>> {
    const rows = await this.rpc('notifications_page', { p_limit: 20, p_cursor: this.cursor(cursor) });
    return takePage(rows.map((r: Row<'notifications_page'>): NotificationView => ({
      id: r.id, type: r.type as NotificationType, actorId: r.actor_id, actorName: r.actor_name ?? 'Someone', postId: r.post_id ?? null, commentId: r.comment_id ?? null,
      createdAt: r.created_at, read: r.read, followStatus: (r.follow_status ?? null) as FollowStatus | null, cursor: r.page_cursor })), 20);
  }
  async unreadCount() { return (await this.rpc('unread_notification_count')) as number; }
  async markRead(ids?: string[]) { await this.rpc('mark_notifications_read', ids ? { p_ids: ids } : {}); }

  async report(target: ReportTarget, targetId: string, reason: ReportReason, details: string) {
    const bad = validateReport(reason, details);
    if (bad) throw new SocialFailure('invalid', bad);
    await this.rpc('report_content', { p_type: target, p_target: targetId, p_reason: reason, p_details: details });
  }

  /** One createSignedUrls call per bucket for everything not already cached. Failed paths are simply absent from the result. */
  async mediaUrls(refs: MediaRef[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const missing = new Map<string, Set<string>>();
    const now = Date.now();
    for (const r of refs) {
      const hit = this.urls.get(`${r.bucket}:${r.path}`);
      if (hit && hit.exp > now) out.set(r.path, hit.url);
      else (missing.get(r.bucket) ?? missing.set(r.bucket, new Set()).get(r.bucket)!).add(r.path);
    }
    await Promise.all([...missing].map(async ([bucket, paths]) => {
      const { data, error } = await this.sb.storage.from(bucket).createSignedUrls([...paths], SIGNED_URL_TTL_S);
      if (error || !data) return;
      for (const d of data) if (d.path && d.signedUrl && !d.error) { this.urls.set(`${bucket}:${d.path}`, { url: d.signedUrl, exp: Date.now() + SIGNED_URL_CACHE_MS }); out.set(d.path, d.signedUrl); }
    }));
    return out;
  }
}
