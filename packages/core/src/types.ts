export type Intention = 'long-term' | 'long-term-open' | 'short-term-open' | 'figuring-out' | 'friends-first';

export const INTENTION_LABEL: Record<Intention, string> = {
  'long-term': 'Long-term partner',
  'long-term-open': 'Long-term, open to short',
  'short-term-open': 'Short-term, open to long',
  'figuring-out': 'Still figuring it out',
  'friends-first': 'Friends first',
};

/** A photo is either local generated placeholder art or a URI (may fail to load). */
export type Photo =
  | { id: string; kind: 'generated'; seed: number; alt: string }
  | { id: string; kind: 'uri'; uri: string; alt: string };

export interface Prompt { question: string; answer: string }

/**
 * Verification is a state the system grants, never something a user declares.
 * In Phase 1 the only state is 'demo' (visibly labelled) or 'none'.
 */
export type Verification = 'none' | 'demo-photo-check';

export interface Profile {
  id: string;
  name: string;
  age: number;
  /** Approximate area only. Never coordinates. */
  area: string;
  distanceKm: number; // rounded, approximate
  pronouns?: string;
  work?: string;
  bio: string;
  intention: Intention;
  interests: string[];
  prompts: Prompt[];
  photos: Photo[];
  verification: Verification;
  /** Demo flag: this synthetic profile is scripted to like you back. */
  demoLikesYou?: boolean;
  followers: number;
  following: number;
}

export type Audience = 'public' | 'followers';

export interface Comment { id: string; authorId: string; text: string; createdAt: number }

export interface Post {
  id: string;
  authorId: string;
  photo: Photo | null;
  caption: string;
  audience: Audience;
  createdAt: number;
  likeCount: number;
  likedByMe: boolean;
  savedByMe: boolean;
  comments: Comment[];
}

export type Delivery = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Message { id: string; fromMe: boolean; text: string; createdAt: number; delivery: Delivery }

export interface Match { profileId: string; matchedAt: number; demo: boolean }

export interface Conversation { profileId: string; messages: Message[]; unread: number }

export interface Filters {
  ageMin: number;
  ageMax: number;
  maxDistanceKm: number;
  intentions: Intention[];
  interests: string[];
}

export const DEFAULT_FILTERS: Filters = { ageMin: 18, ageMax: 60, maxDistanceKm: 100, intentions: [], interests: [] };

export interface PrivacySettings {
  datingDiscoverable: boolean;
  socialVisibility: 'public' | 'followers';
  showDistance: boolean;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Report { id: string; profileId: string; reason: string; details: string; createdAt: number }

export interface AppState {
  version: number;
  me: Profile;
  profiles: Record<string, Profile>;
  posts: Post[];
  /** Private dating activity. Never rendered on social surfaces. */
  liked: string[];
  passed: string[];
  matches: Match[];
  following: string[];
  followers: string[];
  conversations: Record<string, Conversation>;
  blocked: string[];
  reports: Report[];
  filters: Filters;
  privacy: PrivacySettings;
  theme: ThemePreference;
}
