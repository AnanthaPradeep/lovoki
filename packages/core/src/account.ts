import { ageOn, dobError, todayLocalIso } from './age';
import { ALL_INTERESTS, ALL_INTENTIONS } from './seed';
import { LIMITS } from './logic';
import type { Intention, Prompt } from './types';
import type { AvatarCrop, DatingFilters, Gender, PlaceHit } from './dating';
import { GENDER_CUSTOM_MAX, validateUsername, type ProfileDetails, type VisibilityMap } from './profile';

/** Five steps, about three minutes. Everything optional lives in "Complete your profile" on the profile page. */
export type Step = 'basics' | 'preferences' | 'photos' | 'privacy' | 'review';
export const STEPS: { id: Step; label: string }[] = [
  { id: 'basics', label: 'Basics' }, { id: 'preferences', label: 'Preferences' }, { id: 'photos', label: 'Photos' }, { id: 'privacy', label: 'Place & privacy' }, { id: 'review', label: 'Review' },
];
export const stepIndex = (s: Step) => STEPS.findIndex((x) => x.id === s);
export const isStep = (s: string): s is Step => STEPS.some((x) => x.id === s);

export type InterestedIn = 'women' | 'men' | 'non-binary';
export const INTERESTED_IN: { id: InterestedIn; label: string }[] = [
  { id: 'women', label: 'Women' }, { id: 'men', label: 'Men' }, { id: 'non-binary', label: 'Non-binary people' },
];
export type SocialVisibility = 'public' | 'followers';
export type AllowComments = 'everyone' | 'followers' | 'nobody';

export const PROMPT_QUESTIONS = ['A perfect Sunday', 'I geek out on', 'Together, we could', 'My simple pleasures', 'The way to win me over', 'Green flags I look for', 'Unpopular opinion', 'Dating me is like'] as const;
export const ACCOUNT_LIMITS = { ...LIMITS, pronouns: 30, area: 80, prompts: 3, photos: 6, distanceMax: 500 } as const;

export const interestSlug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SLUG_TO_LABEL = new Map(ALL_INTERESTS.map((l) => [interestSlug(l), l]));
export const interestLabel = (slug: string) => SLUG_TO_LABEL.get(slug);

export interface AccountPhoto { id: string; path: string; position: number; contentType: string; sizeBytes: number }

/** The signed-in owner's own record. dateOfBirth is private: it never appears in any public view. */
export interface Account {
  userId: string; email: string | null;
  username: string | null; displayName: string; pronouns: string; dateOfBirth: string | null; age: number | null;
  bio: string; interests: string[]; prompts: Prompt[];
  intention: Intention | null; interestedIn: InterestedIn[]; ageMin: number; ageMax: number; maxDistanceKm: number | null;
  areaLabel: string; socialVisibility: SocialVisibility; datingDiscoverable: boolean;
  photos: AccountPhoto[];
  onboarding: { currentStep: Step; completedAt: string | null };
  /** Gender (null until chosen), the custom label for "self-describe", and what others may see of it. */
  gender: Gender | null; genderCustom: string | null; showGender: boolean; showDistance: boolean;
  /** The chosen place, with no coordinates (the database never returns them). */
  place: PlaceHit | null;
  avatarPhotoId: string | null; avatarCrop: AvatarCrop | null;
  details: ProfileDetails; visibility: VisibilityMap;
  allowComments: AllowComments; showFollowerCounts: boolean;
  /** Null until the person has accepted the terms. */
  consent: { termsVersion: string; marketing: boolean } | null;
  filterIntentions: string[]; filterInterests: string[];
  filterHeightMin: number | null; filterHeightMax: number | null; filterDrinking: string[]; filterSmoking: string[]; filterKids: string[];
}

export const accountFilters = (a: Account): DatingFilters => ({
  intentions: a.filterIntentions, interests: a.filterInterests, heightMin: a.filterHeightMin, heightMax: a.filterHeightMax,
  drinking: a.filterDrinking, smoking: a.filterSmoking, kids: a.filterKids,
});

export interface BasicsInput { displayName: string; dateOfBirth: string; pronouns: string; username: string; gender: Gender | ''; genderCustom: string }
/** What save_basics stores. Username, gender and consent have their own calls. */
export type BasicsSave = Pick<BasicsInput, 'displayName' | 'dateOfBirth' | 'pronouns'>;
export interface AboutInput { bio: string; interests: string[]; prompts: Prompt[] }
export interface PreferencesInput { intention: Intention | null; interestedIn: InterestedIn[]; ageMin: number; ageMax: number; maxDistanceKm: number | null }
export interface PrivacyInput { areaLabel: string; socialVisibility: SocialVisibility; datingDiscoverable: boolean }
/** The place step edits a place, not a label: the label is derived from it. */
export interface PrivacyDraft { place: PlaceHit | null; socialVisibility: SocialVisibility; datingDiscoverable: boolean }
export interface DatingProfileInput { gender: Gender; genderCustom?: string | null; showGender: boolean; showDistance: boolean }
export interface Drafts { basics: BasicsInput; about: AboutInput; preferences: PreferencesInput; privacy: PrivacyDraft }
export type FieldErrors = Record<string, string>;

export function draftsFromAccount(a: Account): Drafts {
  return {
    basics: { displayName: a.displayName, dateOfBirth: a.dateOfBirth ?? '', pronouns: a.pronouns, username: a.username ?? '', gender: a.gender ?? '', genderCustom: a.genderCustom ?? '' },
    about: { bio: a.bio, interests: [...a.interests], prompts: a.prompts.map((p) => ({ ...p })) },
    preferences: { intention: a.intention, interestedIn: [...a.interestedIn], ageMin: a.ageMin, ageMax: a.ageMax, maxDistanceKm: a.maxDistanceKm },
    privacy: { place: a.place, socialVisibility: a.socialVisibility, datingDiscoverable: a.datingDiscoverable },
  };
}

// eslint-disable-next-line no-control-regex -- rejecting control characters is the purpose of this check
const CONTROL = /[\u0000-\u001f\u007f]/;

export function validateBasics(i: BasicsInput, today = todayLocalIso(), dobLocked = false, opts: { requireIdentity?: boolean } = { requireIdentity: true }): FieldErrors {
  const e: FieldErrors = {};
  const n = i.displayName.trim();
  if (!n) e.displayName = 'Add the name you want people to see.';
  else if (n.length > ACCOUNT_LIMITS.name) e.displayName = `Keep your name under ${ACCOUNT_LIMITS.name} characters.`;
  else if (CONTROL.test(n)) e.displayName = 'Remove special control characters from your name.';
  if (!dobLocked) { const d = dobError(i.dateOfBirth, today); if (d) e.dateOfBirth = d; }
  if (i.pronouns.length > ACCOUNT_LIMITS.pronouns) e.pronouns = `Keep pronouns under ${ACCOUNT_LIMITS.pronouns} characters.`;
  if (opts.requireIdentity) {
    const u = validateUsername(i.username); if (u) e.username = u;
    if (!i.gender) e.gender = 'Choose your gender.';
    else if (i.gender === 'self-describe') {
      const c = i.genderCustom.trim();
      if (!c) e.genderCustom = 'Tell us how you describe your gender.';
      else if ([...c].length > GENDER_CUSTOM_MAX || CONTROL.test(c)) e.genderCustom = `Keep this under ${GENDER_CUSTOM_MAX} characters.`;
    }
  }
  return e;
}

export function validateAbout(i: AboutInput): FieldErrors {
  const e: FieldErrors = {};
  if (i.bio.length > ACCOUNT_LIMITS.bio) e.bio = `Bio is ${i.bio.length - ACCOUNT_LIMITS.bio} characters over the ${ACCOUNT_LIMITS.bio} limit.`;
  if (i.interests.length > ACCOUNT_LIMITS.interestsMax) e.interests = `Pick up to ${ACCOUNT_LIMITS.interestsMax} interests.`;
  else if (i.interests.some((x) => !SLUG_TO_LABEL.has(interestSlug(x)))) e.interests = 'Choose interests from the list.';
  if (i.prompts.length > ACCOUNT_LIMITS.prompts) e.prompts = `Answer up to ${ACCOUNT_LIMITS.prompts} prompts.`;
  const seen = new Set<string>();
  i.prompts.forEach((p, idx) => {
    if (!(PROMPT_QUESTIONS as readonly string[]).includes(p.question)) e[`prompt${idx}`] = 'Choose a prompt from the list.';
    else if (seen.has(p.question)) e[`prompt${idx}`] = 'Each prompt can only be used once.';
    else if (!p.answer.trim()) e[`prompt${idx}`] = 'Answer this prompt or remove it.';
    else if (p.answer.length > ACCOUNT_LIMITS.answer) e[`prompt${idx}`] = `Keep answers under ${ACCOUNT_LIMITS.answer} characters.`;
    seen.add(p.question);
  });
  return e;
}

export function validatePreferences(i: PreferencesInput): FieldErrors {
  const e: FieldErrors = {};
  if (!i.intention || !ALL_INTENTIONS.includes(i.intention)) e.intention = 'Choose what you’re looking for.';
  if (i.interestedIn.length === 0) e.interestedIn = 'Choose who you’d like to meet.';
  const ok = (n: number) => Number.isInteger(n) && n >= 18 && n <= 99;
  if (!ok(i.ageMin) || !ok(i.ageMax)) e.ageRange = 'Ages must be whole numbers from 18 to 99.';
  else if (i.ageMin > i.ageMax) e.ageRange = 'The minimum age is above the maximum.';
  if (i.maxDistanceKm !== null && (!Number.isInteger(i.maxDistanceKm) || i.maxDistanceKm < 1 || i.maxDistanceKm > ACCOUNT_LIMITS.distanceMax)) e.maxDistanceKm = `Choose a distance from 1 to ${ACCOUNT_LIMITS.distanceMax} km, or leave it open.`;
  return e;
}

export function validatePrivacy(i: PrivacyDraft): FieldErrors {
  const e: FieldErrors = {};
  if (!i.place) e.place = 'Choose your city. Search for it by name.';
  return e;
}

export interface Missing { step: Step; field: string; label: string }

/** The small, explicit set of required fields. Everything else is optional. */
export function missingRequired(a: Account, today = todayLocalIso()): Missing[] {
  const m: Missing[] = [];
  if (!a.displayName.trim()) m.push({ step: 'basics', field: 'displayName', label: 'Add your display name' });
  if (!a.username) m.push({ step: 'basics', field: 'username', label: 'Choose a username' });
  if (!a.dateOfBirth || dobError(a.dateOfBirth, today)) m.push({ step: 'basics', field: 'dateOfBirth', label: 'Add your date of birth (18 or over)' });
  if (!a.gender) m.push({ step: 'basics', field: 'gender', label: 'Choose your gender' });
  if (!a.consent) m.push({ step: 'basics', field: 'consent', label: 'Accept the terms and confirm you’re 18 or over' });
  if (!a.intention) m.push({ step: 'preferences', field: 'intention', label: 'Choose what you’re looking for' });
  if (a.interestedIn.length === 0) m.push({ step: 'preferences', field: 'interestedIn', label: 'Choose who you’d like to meet' });
  if (a.photos.length < 1) m.push({ step: 'photos', field: 'photos', label: 'Add at least one photo' });
  if (!a.place) m.push({ step: 'privacy', field: 'place', label: 'Choose your city' });
  return m;
}
export const REQUIRED_COUNT = 9;

/** Where to resume: the saved step, but never past the first step that still lacks a required field. */
export function resumeStep(a: Account, today = todayLocalIso()): Step | null {
  if (a.onboarding.completedAt) return null;
  const first = missingRequired(a, today).map((m) => stepIndex(m.step)).sort((x, y) => x - y)[0];
  const saved = stepIndex(a.onboarding.currentStep);
  const idx = first === undefined ? saved : Math.min(saved, first);
  return STEPS[Math.max(0, idx)]!.id;
}

/** A "Complete your profile" card. Progressive, never blocking. Sensitive fields (religion) are never suggested. */
export interface ProfileCard { id: string; title: string; body: string; done: boolean; group: string }
export function profileCards(a: Account): ProfileCard[] {
  const d = a.details;
  return [
    { id: 'about', group: 'about', title: 'Write a short bio', body: 'A line or two helps people start a conversation.', done: a.bio.trim().length >= 40 },
    { id: 'interests', group: 'about', title: 'Pick your interests', body: 'Three or more makes it easy to find common ground.', done: a.interests.length >= 3 },
    { id: 'prompts', group: 'about', title: 'Answer a prompt', body: 'Two answers give people something to reply to.', done: a.prompts.length >= 2 },
    { id: 'photos', group: 'photos', title: 'Add more photos', body: 'Three or more photos is a good start.', done: a.photos.length >= 3 },
    { id: 'avatar', group: 'photos', title: 'Choose your avatar', body: 'The small round picture next to your name.', done: a.avatarPhotoId !== null },
    { id: 'essentials', group: 'essentials', title: 'Height, work and education', body: 'Optional. You choose who sees each one.', done: d.heightCm !== null || !!d.jobTitle || !!d.educationLevel },
    { id: 'languages', group: 'languages', title: 'Languages you speak', body: 'Handy for finding someone you can chat easily with.', done: d.languages.length > 0 },
    { id: 'lifestyle', group: 'lifestyle', title: 'Lifestyle', body: 'Drinking, smoking, exercise, diet and pets.', done: !!(d.drinking || d.smoking || d.exercise || d.diet || d.pets.length) },
    { id: 'family', group: 'family', title: 'Kids and relationship style', body: 'Optional, and only if you want to share it.', done: !!(d.hasKids || d.wantsKids || d.relationshipStructure) },
    { id: 'links', group: 'links', title: 'Instagram', body: 'Shown to your matches only, unless you choose otherwise.', done: !!d.instagramHandle },
  ];
}

export function completionPercent(a: Account, today = todayLocalIso()): { percent: number; suggestions: string[]; cards: ProfileCard[] } {
  const cards = profileCards(a);
  const required = REQUIRED_COUNT - missingRequired(a, today).length;
  const done = required + cards.filter((c) => c.done).length;
  return { percent: Math.round((done / (REQUIRED_COUNT + cards.length)) * 100), suggestions: cards.filter((c) => !c.done).map((c) => c.title), cards };
}

export const ageFromDob = (dob: string | null, today = todayLocalIso()) => (dob ? ageOn(dob, today) : null);
