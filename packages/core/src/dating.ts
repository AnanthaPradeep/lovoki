/* Phase 4 dating domain: types, the DatingApi port, pure helpers (compatibility hints, distance buckets, cursors) and optimistic reducers.
   The database enforces every rule again (see supabase/migrations/20261103000000_phase4_dating.sql); these helpers explain and
   pre-check so the UI can be fast and honest. Nothing here ever handles coordinates of another person or a like flag. */

import type { InterestedIn } from './account';
import type { Page } from './social';
import type { VisibleDetails } from './profile';

/** A square crop of a chosen photo: the centre as fractions of the image, and a zoom of 1 to 3. */
export interface AvatarCrop { x: number; y: number; zoom: number }

export type Gender = 'woman' | 'man' | 'non-binary' | 'self-describe';
export const GENDERS: { id: Gender; label: string }[] = [{ id: 'woman', label: 'Woman' }, { id: 'man', label: 'Man' }, { id: 'non-binary', label: 'Non-binary' }, { id: 'self-describe', label: 'Self-describe' }];
/** "Genderfluid" for a self-described gender, otherwise the standard label. Null when the person hides it. */
export const genderLabel = (g: Gender | null | undefined, custom?: string | null) => (g === 'self-describe' ? (custom?.trim() || 'Self-described') : (GENDERS.find((x) => x.id === g)?.label ?? null));

/** Named limits, mirrored from the database for display only. The database is authoritative. */
export const DATING_LIMITS = { dailyLikes: 50, discoverPerHour: 120, passDays: 90, pageSize: 10 } as const;

export type DistanceBucket = '<5' | '<10' | '<25' | '<50' | '<100' | '100+';
export const BUCKET_EDGES = [5, 10, 25, 50, 100] as const;

/** Mirrors the database: a number only ever turns into a bucket, and the viewer's max distance rounds UP to a bucket edge. */
export function bucketOf(km: number): DistanceBucket {
  return km < 5 ? '<5' : km < 10 ? '<10' : km < 25 ? '<25' : km < 50 ? '<50' : km < 100 ? '<100' : '100+';
}
export function effectiveMaxKm(max: number | null): number | null {
  if (max === null) return null;
  return BUCKET_EDGES.find((e) => max <= e) ?? null;
}
export const bucketLabel = (b: DistanceBucket | null): string | null => (b === null ? null : b === '100+' ? 'More than 100 km away' : `Less than ${b.slice(1)} km away`);
const BUCKETS: string[] = ['<5', '<10', '<25', '<50', '<100', '100+'];
export const isBucket = (s: unknown): s is DistanceBucket => typeof s === 'string' && BUCKETS.includes(s);

/** Great-circle distance in km. Used by fakes and tests only: the real distance is computed in the database from rounded places. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Two decimals is about 1 km. The database rounds again; this is what the owner sees saved. */
export const roundCoord = (n: number) => Math.round(n * 100) / 100;

/** A place from the places table. Clients never receive coordinates: only a label they can show. */
export interface PlaceHit { id: number | null; name: string; region: string; countryCode: string; country: string; label: string }
/** Mirrors the database: the area label stored on a profile is "Name, Region", at most 80 characters. */
export const areaLabelOf = (p: Pick<PlaceHit, 'name' | 'region'>) => (p.region && p.region !== p.name ? `${p.name}, ${p.region}` : p.name).slice(0, 80);

/* ------------------------------------------------------------------ compatibility hints */

// A self-described gender is matched like non-binary (the database does the same).
export const wantsGender = (g: Gender | null, wanted: InterestedIn[]) => g !== null && wanted.includes(g === 'woman' ? 'women' : g === 'man' ? 'men' : 'non-binary');
export interface Prefs { gender: Gender | null; interestedIn: InterestedIn[]; age: number | null; ageMin: number; ageMax: number }
/** Hard compatibility both ways (distance is separate because the real distance never reaches the client). */
export function compatible(a: Prefs, b: Prefs): boolean {
  if (a.age === null || b.age === null || a.age < 18 || b.age < 18) return false;
  return wantsGender(b.gender, a.interestedIn) && wantsGender(a.gender, b.interestedIn)
    && b.age >= a.ageMin && b.age <= a.ageMax && a.age >= b.ageMin && a.age <= b.ageMax;
}

/* ------------------------------------------------------------------------ views */

export interface DatingPrompt { question: string; answer: string }
export interface DatingCard {
  userId: string; displayName: string; username: string | null; age: number; gender: Gender | null; genderCustom: string | null; areaLabel: string; distanceBucket: DistanceBucket | null;
  intention: string; interests: string[]; prompts: DatingPrompt[]; photoPaths: string[]; bio: string;
  avatarPath: string | null; avatarCrop: AvatarCrop | null;
  /** The optional fields this viewer is allowed to see, already filtered by the database. */
  details: VisibleDetails;
  /** Only for matches (M-visibility). */
  pronouns: string | null;
  /** Fictional sample person. Liking one stores nothing and can never become a match. */
  isSample: boolean;
  cursor: string;
  /** Needed by the list reducers; equals userId. */
  id: string;
}
export interface DatingProfileView extends Omit<DatingCard, 'cursor' | 'id'> { isMatch: boolean; matchId: string | null; matchedAt: string | null }
export interface MatchView extends DatingCard { matchId: string; matchedAt: string }
export interface DatingStatus { paused: boolean; hasGender: boolean; hasPlace: boolean; likesLeft: number; dailyCap: number }
export interface LikeResult { matched: boolean; matchId: string | null }

export interface DatingFilters { intentions: string[]; interests: string[]; heightMin: number | null; heightMax: number | null; drinking: string[]; smoking: string[]; kids: string[] }
export const noFilters = (): DatingFilters => ({ intentions: [], interests: [], heightMin: null, heightMax: null, drinking: [], smoking: [], kids: [] });

export type DatingErrorCode =
  | 'paused' | 'profile_incomplete' | 'daily_limit' | 'rate_limited' | 'not_found' | 'invalid_cursor' | 'incomplete' | 'unauthorized' | 'network' | 'invalid' | 'unknown';
export class DatingFailure extends Error {
  readonly code: DatingErrorCode;
  constructor(code: DatingErrorCode, message: string) { super(message); this.name = 'DatingFailure'; this.code = code; }
}

/** Dating persistence port. Screens depend on this, never on the SDK. */
export interface DatingApi {
  discover(cursor?: string | null): Promise<Page<DatingCard>>;
  profile(userId: string): Promise<DatingProfileView | null>;
  like(userId: string): Promise<LikeResult>;
  pass(userId: string): Promise<void>;
  matches(cursor?: string | null): Promise<Page<MatchView>>;
  unmatch(matchId: string): Promise<void>;
  status(): Promise<DatingStatus>;
}

/* --------------------------------------------------------------------- cursors */

export const DISCOVER_CURSOR_RE = /^\d{4}-\d{2}-\d{2}\|[0-9a-f]{32}\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isDiscoverCursor = (s: unknown): s is string => typeof s === 'string' && DISCOVER_CURSOR_RE.test(s);
/** A cursor that does not look like one is dropped, never forwarded. */
export const safeDiscoverCursor = (s: string | null | undefined) => (isDiscoverCursor(s) ? s : null);

/* ----------------------------------------------------------------- deck reducer */

/** The discovery deck. `items[0]` is the card on screen. Actions are optimistic: the card leaves at once and returns on failure. */
export interface DeckState {
  items: DatingCard[]; next: string | null; loaded: boolean;
  /** Cards removed optimistically and still awaiting the server, so a failure can put them back where they were. */
  pending: { card: DatingCard; index: number; action: 'like' | 'pass' }[];
  /** Set when a like came back matched. */
  matched: { card: DatingCard; matchId: string } | null;
}
export const emptyDeck = (): DeckState => ({ items: [], next: null, loaded: false, pending: [], matched: null });

export type DeckAction =
  | { type: 'replace'; page: Page<DatingCard> }
  | { type: 'append'; page: Page<DatingCard> }
  | { type: 'act/start'; id: string; action: 'like' | 'pass' }
  | { type: 'act/ok'; id: string; result?: LikeResult }
  | { type: 'act/fail'; id: string }
  | { type: 'dismissMatch' };

export function deckReducer(s: DeckState, a: DeckAction): DeckState {
  switch (a.type) {
    case 'replace': return { ...emptyDeck(), items: a.page.items, next: a.page.next, loaded: true };
    case 'append': {
      const seen = new Set([...s.items, ...s.pending.map((p) => p.card)].map((c) => c.id));
      return { ...s, items: [...s.items, ...a.page.items.filter((c) => !seen.has(c.id))], next: a.page.next, loaded: true };
    }
    case 'act/start': {
      const index = s.items.findIndex((c) => c.id === a.id);
      if (index < 0 || s.pending.some((p) => p.card.id === a.id)) return s; // unknown card, or a request is already in flight: ignore the second tap
      return { ...s, items: s.items.filter((c) => c.id !== a.id), pending: [...s.pending, { card: s.items[index]!, index, action: a.action }] };
    }
    case 'act/ok': {
      const p = s.pending.find((x) => x.card.id === a.id);
      const rest = s.pending.filter((x) => x.card.id !== a.id);
      if (p && p.action === 'like' && a.result?.matched && a.result.matchId) return { ...s, pending: rest, matched: { card: p.card, matchId: a.result.matchId } };
      return { ...s, pending: rest };
    }
    case 'act/fail': {
      const p = s.pending.find((x) => x.card.id === a.id);
      if (!p) return s;
      const items = [...s.items]; items.splice(Math.min(p.index, items.length), 0, p.card);
      return { ...s, items, pending: s.pending.filter((x) => x.card.id !== a.id) };
    }
    case 'dismissMatch': return { ...s, matched: null };
  }
}

/** Why a deck is empty, in the order a person can act on it. */
export type EmptyReason = 'paused' | 'needs-gender' | 'daily-limit' | 'no-one-new';
export function emptyReason(status: DatingStatus | null, hasFilters: boolean): { reason: EmptyReason; title: string; body: string } {
  // A brand-new account is both "no gender yet" and "Show me in Discover is off" (it starts off: dating is opt-in), so setup comes first.
  if (status && !status.hasGender) return { reason: 'needs-gender', title: 'Add your gender to start', body: 'Discover matches people by who each of you wants to meet, so it needs your gender. It’s one tap in Settings, and you choose whether it’s shown on your profile. Then turn on “Show me in Discover” when you want to appear and browse. It starts off, so nobody sees you until you choose.' };
  if (status?.paused) return { reason: 'paused', title: 'Dating is paused', body: 'You’re hidden from Discover and can’t like anyone while “Show me in Discover” is off. Your matches stay. Turn it back on in Settings when you’re ready.' };
  if (status && status.likesLeft <= 0) return { reason: 'daily-limit', title: 'That’s today’s limit', body: `You’ve used your ${status.dailyCap} likes for today. They come back gradually over the next 24 hours. You can still look through profiles and pass.` };
  return { reason: 'no-one-new', title: 'No one new for now', body: hasFilters ? 'Nobody new matches your filters. Widen your age range, distance or filters, or check back later.' : 'There’s no one new right now. Widen your age range or distance in your filters, or check back later. We don’t invent people to fill the space.' };
}

export const matchedAgo = (iso: string, now = Date.now()): string => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d < 14 ? `${d} ${d === 1 ? 'day' : 'days'} ago` : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
