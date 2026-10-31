import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DATING_LIMITS, DatingFailure, interestLabel, isBucket, safeDiscoverCursor, safeCursor, takePage,
  type AvatarCrop, type VisibleDetails, type DatingApi, type DatingCard, type DatingProfileView, type DatingStatus, type Gender, type LikeResult, type MatchView, type Page,
} from '@lovoki/core';
import type { Database } from './database.types';

type Fn = Database['public']['Functions'];
type Row<K extends keyof Fn> = Fn[K]['Returns'] extends (infer R)[] ? R : never;
interface DbError { message?: string; code?: string; status?: number }

/** Maps Postgres/PostgREST errors to safe messages. Never shows raw database text. */
export function toDatingFailure(e: unknown): DatingFailure {
  if (e instanceof DatingFailure) return e;
  const r: DbError = typeof e === 'object' && e ? (e as DbError) : {};
  const m = r.message ?? '';
  if (e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(m)) return new DatingFailure('network', 'Can’t reach LOVOKI. Check your connection and try again.');
  if (m.includes('LOVOKI_PAUSED')) return new DatingFailure('paused', 'Dating is paused. Turn on “Show me in Discover” in Settings to continue.');
  if (m.includes('LOVOKI_PROFILE_INCOMPLETE')) return new DatingFailure('profile_incomplete', 'Add your gender in Settings to use Discover.');
  if (m.includes('LOVOKI_DAILY_LIMIT')) return new DatingFailure('daily_limit', 'You’ve reached today’s limit of likes.');
  if (m.includes('LOVOKI_RATE_LIMITED')) return new DatingFailure('rate_limited', 'That’s a lot of browsing in a short time. Take a breather and try again in a little while.');
  if (m.includes('LOVOKI_NOT_FOUND')) return new DatingFailure('not_found', 'That isn’t available any more.');
  if (m.includes('LOVOKI_INVALID_CURSOR')) return new DatingFailure('invalid_cursor', 'That list is out of date. Reload to continue.');
  if (m.includes('LOVOKI_ONBOARDING_INCOMPLETE')) return new DatingFailure('incomplete', 'Finish setting up your profile first.');
  if (m.includes('LOVOKI_UNAUTHENTICATED') || r.status === 401 || r.code === 'PGRST301' || /jwt/i.test(m)) return new DatingFailure('unauthorized', 'Your session ended. Log in again.');
  if (m.includes('LOVOKI_INVALID') || /^2[23]/.test(r.code ?? '')) return new DatingFailure('invalid', 'That isn’t valid. Check it and try again.');
  return new DatingFailure('unknown', 'Something went wrong. Try again.');
}

type CardRow = { user_id: string; display_name: string | null; username?: string | null; gender_custom?: string | null; avatar_path?: string | null; avatar_crop?: unknown; details?: unknown; age: number | null; gender: string | null; area_label: string | null; distance_bucket: string | null; intention: string | null;
  interests: string[] | null; prompts: unknown; photo_paths: string[] | null; bio: string | null; pronouns?: string | null };

function toCard(r: CardRow, cursor: string): DatingCard {
  const prompts = Array.isArray(r.prompts) ? (r.prompts as { question?: string; answer?: string }[]).map((p) => ({ question: p.question ?? '', answer: p.answer ?? '' })) : [];
  return {
    id: r.user_id, userId: r.user_id, displayName: r.display_name ?? 'Someone', username: r.username ?? null, age: r.age ?? 18, gender: (r.gender ?? null) as Gender | null, genderCustom: r.gender_custom ?? null, areaLabel: r.area_label ?? '',
    avatarPath: r.avatar_path ?? null, avatarCrop: (r.avatar_crop ?? null) as AvatarCrop | null, details: (r.details ?? {}) as VisibleDetails,
    distanceBucket: isBucket(r.distance_bucket) ? r.distance_bucket : null, intention: r.intention ?? '',
    interests: (r.interests ?? []).map((s) => interestLabel(s) ?? s), prompts, photoPaths: r.photo_paths ?? [], bio: r.bio ?? '', pronouns: r.pronouns ?? null, isSample: false, cursor,
  };
}

export class SupabaseDatingApi implements DatingApi {
  constructor(private sb: SupabaseClient) {}

  private async rpc<K extends keyof Fn>(fn: K, args: Fn[K]['Args'] = {} as Fn[K]['Args']): Promise<Fn[K]['Returns']> {
    const { data, error } = await this.sb.rpc(fn as string, args as Record<string, unknown>);
    if (error) throw toDatingFailure(error);
    return data as Fn[K]['Returns'];
  }

  async discover(cursor?: string | null): Promise<Page<DatingCard>> {
    const safe = safeDiscoverCursor(cursor);
    if (cursor && !safe) throw new DatingFailure('invalid_cursor', 'That list is out of date. Reload to continue.');
    const rows = await this.rpc('discover_profiles', { p_limit: DATING_LIMITS.pageSize, p_cursor: safe ?? undefined });
    const page = takePage(rows.map((r: Row<'discover_profiles'>) => toCard(r as unknown as CardRow, r.page_cursor)), DATING_LIMITS.pageSize);
    return { ...page, items: await this.flagSamples(page.items) };
  }

  /** The sample flag is fetched separately (ids you already hold, flag only) so the card functions stay unchanged. */
  private async flagSamples<T extends { userId: string; isSample: boolean }>(items: T[]): Promise<T[]> {
    if (!items.length) return items;
    const rows = (await this.rpc('sample_flags', { p_ids: items.map((c) => c.userId) })) as { user_id: string; is_sample: boolean }[];
    const flagged = new Set(rows.filter((r) => r.is_sample).map((r) => r.user_id));
    return items.map((c) => (flagged.has(c.userId) ? { ...c, isSample: true } : c));
  }

  async profile(userId: string): Promise<DatingProfileView | null> {
    const r = (await this.rpc('dating_profile', { p_user: userId }))[0];
    if (!r) return null;
    const { cursor: _c, id: _i, ...card0 } = toCard(r as unknown as CardRow, ''); void _c; void _i;
    const [card] = await this.flagSamples([card0]);
    return { ...card!, isMatch: r.is_match, matchId: r.match_id ?? null, matchedAt: r.matched_at ?? null };
  }

  async like(userId: string): Promise<LikeResult> {
    const r = (await this.rpc('like_profile', { p_target: userId }))[0];
    return { matched: !!r?.matched, matchId: r?.match_id ?? null };
  }
  async pass(userId: string) { await this.rpc('pass_profile', { p_target: userId }); }

  async matches(cursor?: string | null): Promise<Page<MatchView>> {
    const safe = safeCursor(cursor);
    if (cursor && !safe) throw new DatingFailure('invalid_cursor', 'That list is out of date. Reload to continue.');
    const rows = await this.rpc('list_matches', { p_limit: 20, p_cursor: safe ?? undefined });
    return takePage(rows.map((r: Row<'list_matches'>): MatchView => ({ ...toCard(r as unknown as CardRow, r.page_cursor), matchId: r.match_id, matchedAt: r.matched_at })), 20);
  }
  async unmatch(matchId: string) { await this.rpc('unmatch', { p_match: matchId }); }

  async status(): Promise<DatingStatus> {
    const r = (await this.rpc('dating_status'))[0];
    return { paused: !!r?.paused, hasGender: !!r?.has_gender, hasPlace: !!r?.has_place, likesLeft: r?.likes_left ?? 0, dailyCap: r?.daily_cap ?? DATING_LIMITS.dailyLikes };
  }
}
