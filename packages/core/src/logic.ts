import type { AppState, Filters, PrivacySettings, Profile, Post, ThemePreference, Audience, Photo, Delivery, Comment } from './types';
import { DEFAULT_FILTERS } from './types';

export type Action =
  | { type: 'like'; profileId: string; now: number }
  | { type: 'pass'; profileId: string }
  | { type: 'unmatch'; profileId: string }
  | { type: 'follow'; profileId: string }
  | { type: 'unfollow'; profileId: string }
  | { type: 'togglePostLike'; postId: string }
  | { type: 'togglePostSave'; postId: string }
  | { type: 'addComment'; postId: string; comment: Comment }
  | { type: 'publishPost'; post: Post }
  | { type: 'addMessage'; profileId: string; id: string; text: string; now: number }
  | { type: 'setDelivery'; profileId: string; id: string; delivery: Delivery }
  | { type: 'markRead'; profileId: string }
  | { type: 'block'; profileId: string }
  | { type: 'unblock'; profileId: string }
  | { type: 'report'; profileId: string; reason: string; details: string; id: string; now: number }
  | { type: 'updateProfile'; patch: Partial<Pick<Profile, 'name' | 'age' | 'area' | 'work' | 'bio' | 'intention' | 'interests' | 'prompts' | 'pronouns'>> }
  | { type: 'setFilters'; filters: Filters }
  | { type: 'setPrivacy'; privacy: Partial<PrivacySettings> }
  | { type: 'setTheme'; theme: ThemePreference }
  | { type: 'replace'; state: AppState };

const without = (list: string[], id: string) => list.filter((x) => x !== id);
const withId = (list: string[], id: string) => (list.includes(id) ? list : [...list, id]);
const mapPost = (s: AppState, id: string, fn: (p: Post) => Post): AppState => ({ ...s, posts: s.posts.map((p) => (p.id === id ? fn(p) : p)) });

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'like': {
      if (s.blocked.includes(a.profileId) || s.liked.includes(a.profileId)) return s;
      const next = { ...s, liked: [...s.liked, a.profileId], passed: without(s.passed, a.profileId) };
      const p = s.profiles[a.profileId];
      // Mutual match only when the other person has also liked you (demo-scripted here).
      if (p?.demoLikesYou && !s.matches.some((m) => m.profileId === a.profileId)) {
        next.matches = [{ profileId: a.profileId, matchedAt: a.now, demo: true }, ...s.matches];
        next.conversations = { ...s.conversations, [a.profileId]: { profileId: a.profileId, messages: [], unread: 0 } };
      }
      return next;
    }
    case 'pass':
      return { ...s, passed: withId(s.passed, a.profileId) };
    case 'unmatch': {
      const { [a.profileId]: _drop, ...conversations } = s.conversations;
      return { ...s, matches: s.matches.filter((m) => m.profileId !== a.profileId), conversations, liked: without(s.liked, a.profileId), passed: withId(s.passed, a.profileId) };
    }
    case 'follow':
      return s.blocked.includes(a.profileId) ? s : { ...s, following: withId(s.following, a.profileId) };
    case 'unfollow':
      return { ...s, following: without(s.following, a.profileId) };
    case 'togglePostLike':
      return mapPost(s, a.postId, (p) => ({ ...p, likedByMe: !p.likedByMe, likeCount: p.likeCount + (p.likedByMe ? -1 : 1) }));
    case 'togglePostSave':
      return mapPost(s, a.postId, (p) => ({ ...p, savedByMe: !p.savedByMe }));
    case 'addComment':
      return mapPost(s, a.postId, (p) => ({ ...p, comments: [...p.comments, a.comment] }));
    case 'publishPost':
      return { ...s, posts: [a.post, ...s.posts] };
    case 'addMessage': {
      const c = s.conversations[a.profileId];
      if (!c || !canMessage(s, a.profileId)) return s;
      return { ...s, conversations: { ...s.conversations, [a.profileId]: { ...c, messages: [...c.messages, { id: a.id, fromMe: true, text: a.text, createdAt: a.now, delivery: 'sending' }] } } };
    }
    case 'setDelivery': {
      const c = s.conversations[a.profileId];
      if (!c) return s;
      return { ...s, conversations: { ...s.conversations, [a.profileId]: { ...c, messages: c.messages.map((m) => (m.id === a.id ? { ...m, delivery: a.delivery } : m)) } } };
    }
    case 'markRead': {
      const c = s.conversations[a.profileId];
      return c && c.unread ? { ...s, conversations: { ...s.conversations, [a.profileId]: { ...c, unread: 0 } } } : s;
    }
    case 'block':
      return {
        ...s,
        blocked: withId(s.blocked, a.profileId),
        following: without(s.following, a.profileId),
        followers: without(s.followers, a.profileId),
        matches: s.matches.filter((m) => m.profileId !== a.profileId),
      };
    case 'unblock':
      return { ...s, blocked: without(s.blocked, a.profileId) };
    case 'report':
      return { ...s, reports: [...s.reports, { id: a.id, profileId: a.profileId, reason: a.reason, details: a.details, createdAt: a.now }] };
    case 'updateProfile':
      return { ...s, me: { ...s.me, ...a.patch } };
    case 'setFilters':
      return { ...s, filters: a.filters };
    case 'setPrivacy':
      return { ...s, privacy: { ...s.privacy, ...a.privacy } };
    case 'setTheme':
      return { ...s, theme: a.theme };
    case 'replace':
      return a.state;
  }
}

/* ---------- selectors ---------- */

export const isBlocked = (s: AppState, id: string) => s.blocked.includes(id);
export const isMatched = (s: AppState, id: string) => s.matches.some((m) => m.profileId === id);
/** Following never unlocks dating messages: a mutual match is required. */
export const canMessage = (s: AppState, id: string) => isMatched(s, id) && !isBlocked(s, id);

export function matchesFilters(p: Profile, f: Filters): boolean {
  if (p.age < f.ageMin || p.age > f.ageMax) return false;
  if (p.distanceKm > f.maxDistanceKm) return false;
  if (f.intentions.length && !f.intentions.includes(p.intention)) return false;
  if (f.interests.length && !f.interests.some((i) => p.interests.includes(i))) return false;
  return true;
}

export const filtersActive = (f: Filters) =>
  f.ageMin !== DEFAULT_FILTERS.ageMin || f.ageMax !== DEFAULT_FILTERS.ageMax || f.maxDistanceKm !== DEFAULT_FILTERS.maxDistanceKm || f.intentions.length > 0 || f.interests.length > 0;

/** Profiles still to decide on, after filters. */
export function discoverQueue(s: AppState): Profile[] {
  const seen = new Set([...s.liked, ...s.passed, ...s.blocked, ...s.matches.map((m) => m.profileId)]);
  return Object.values(s.profiles).filter((p) => !seen.has(p.id) && matchesFilters(p, s.filters));
}

/** Count of undecided profiles regardless of filters, to distinguish "filters too narrow" from "seen everyone". */
export function undecidedCount(s: AppState): number {
  const seen = new Set([...s.liked, ...s.passed, ...s.blocked, ...s.matches.map((m) => m.profileId)]);
  return Object.values(s.profiles).filter((p) => !seen.has(p.id)).length;
}

export function canSeePost(s: AppState, p: Post): boolean {
  if (p.authorId === 'me') return true;
  if (isBlocked(s, p.authorId)) return false;
  return p.audience === 'public' || s.following.includes(p.authorId);
}

export function feed(s: AppState, view: 'following' | 'explore'): Post[] {
  return s.posts
    .filter((p) => canSeePost(s, p))
    .filter((p) => (view === 'following' ? p.authorId === 'me' || s.following.includes(p.authorId) : p.audience === 'public'))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function postsBy(s: AppState, authorId: string): Post[] {
  return s.posts.filter((p) => p.authorId === authorId && canSeePost(s, p)).sort((a, b) => b.createdAt - a.createdAt);
}

export function conversationList(s: AppState) {
  return s.matches
    .filter((m) => !isBlocked(s, m.profileId) && s.conversations[m.profileId])
    .map((m) => {
      const c = s.conversations[m.profileId]!;
      const last = c.messages[c.messages.length - 1];
      return { match: m, profile: s.profiles[m.profileId]!, conversation: c, last, sortKey: last?.createdAt ?? m.matchedAt };
    })
    .sort((a, b) => b.sortKey - a.sortKey);
}

export const unreadTotal = (s: AppState) => conversationList(s).reduce((n, c) => n + c.conversation.unread, 0);

export function profileCompleteness(p: Profile): { percent: number; missing: string[] } {
  const checks: [boolean, string][] = [
    [p.photos.length >= 3, 'Add at least 3 photos'],
    [p.bio.trim().length >= 40, 'Write a bio of 40+ characters'],
    [p.prompts.length >= 2, 'Answer 2 prompts'],
    [p.interests.length >= 3, 'Pick 3 or more interests'],
    [!!p.work?.trim(), 'Add what you do'],
    [!!p.pronouns?.trim(), 'Add pronouns (optional but helpful)'],
  ];
  const done = checks.filter(([ok]) => ok).length;
  return { percent: Math.round((done / checks.length) * 100), missing: checks.filter(([ok]) => !ok).map(([, m]) => m) };
}

/* ---------- validation ---------- */

export interface ProfileDraft { name: string; age: string; area: string; work: string; pronouns: string; bio: string; intention: string; interests: string[]; prompts: { question: string; answer: string }[] }
export type Errors<T> = Partial<Record<keyof T | string, string>>;

export const LIMITS = { name: 40, bio: 300, answer: 160, caption: 2200, comment: 300, message: 1000, interestsMax: 8 } as const;

export function validateProfile(d: ProfileDraft): Errors<ProfileDraft> {
  const e: Errors<ProfileDraft> = {};
  const name = d.name.trim();
  if (!name) e.name = 'Add the name you want people to see.';
  else if (name.length > LIMITS.name) e.name = `Keep your name under ${LIMITS.name} characters.`;
  const age = Number(d.age);
  if (!/^\d+$/.test(d.age.trim())) e.age = 'Enter your age as a whole number.';
  else if (age < 18) e.age = 'LOVOKI is for adults 18 and over.';
  else if (age > 99) e.age = 'Enter an age between 18 and 99.';
  if (!d.area.trim()) e.area = 'Add an approximate area, like a neighbourhood or city.';
  else if (/-?\d{1,3}\.\d{3,}/.test(d.area)) e.area = 'Use a neighbourhood or city, not coordinates.';
  if (d.bio.length > LIMITS.bio) e.bio = `Bio is ${d.bio.length - LIMITS.bio} characters over the ${LIMITS.bio} limit.`;
  if (d.interests.length === 0) e.interests = 'Pick at least one interest.';
  else if (d.interests.length > LIMITS.interestsMax) e.interests = `Pick up to ${LIMITS.interestsMax} interests.`;
  d.prompts.forEach((p, i) => {
    if (!p.answer.trim()) e[`prompt${i}`] = 'Answer this prompt or remove it.';
    else if (p.answer.length > LIMITS.answer) e[`prompt${i}`] = `Keep answers under ${LIMITS.answer} characters.`;
  });
  return e;
}

export function validatePost(caption: string, photo: Photo | null): string | null {
  if (!photo && !caption.trim()) return 'Add a photo or write a caption.';
  if (caption.length > LIMITS.caption) return `Caption is over the ${LIMITS.caption} character limit.`;
  return null;
}

export const newPost = (id: string, caption: string, photo: Photo | null, audience: Audience, now: number): Post => ({
  id, authorId: 'me', caption: caption.trim(), photo, audience, createdAt: now, likeCount: 0, likedByMe: false, savedByMe: false, comments: [],
});

/* ---------- formatting ---------- */

export function relativeTime(t: number, now = Date.now()): string {
  const m = Math.round((now - t) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d` : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const clockTime = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
