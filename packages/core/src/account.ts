import { ageOn, dobError, todayLocalIso } from './age';
import { ALL_INTERESTS, ALL_INTENTIONS } from './seed';
import { LIMITS } from './logic';
import type { Intention, Prompt } from './types';

export type Step = 'basics' | 'about' | 'preferences' | 'photos' | 'privacy' | 'review';
export const STEPS: { id: Step; label: string }[] = [
  { id: 'basics', label: 'Basics' }, { id: 'about', label: 'About you' }, { id: 'preferences', label: 'Preferences' },
  { id: 'photos', label: 'Photos' }, { id: 'privacy', label: 'Privacy' }, { id: 'review', label: 'Review' },
];
export const stepIndex = (s: Step) => STEPS.findIndex((x) => x.id === s);
export const isStep = (s: string): s is Step => STEPS.some((x) => x.id === s);

export type InterestedIn = 'women' | 'men' | 'non-binary';
export const INTERESTED_IN: { id: InterestedIn; label: string }[] = [
  { id: 'women', label: 'Women' }, { id: 'men', label: 'Men' }, { id: 'non-binary', label: 'Non-binary people' },
];
export type SocialVisibility = 'public' | 'followers';

export const PROMPT_QUESTIONS = ['A perfect Sunday', 'I geek out on', 'Together, we could', 'My simple pleasures', 'The way to win me over', 'Green flags I look for', 'Unpopular opinion', 'Dating me is like'] as const;
export const ACCOUNT_LIMITS = { ...LIMITS, pronouns: 30, area: 80, prompts: 3, photos: 6, distanceMax: 500 } as const;

export const interestSlug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SLUG_TO_LABEL = new Map(ALL_INTERESTS.map((l) => [interestSlug(l), l]));
export const interestLabel = (slug: string) => SLUG_TO_LABEL.get(slug);

export interface AccountPhoto { id: string; path: string; position: number; contentType: string; sizeBytes: number }

/** The signed-in owner's own record. dateOfBirth is private: it never appears in any public view. */
export interface Account {
  userId: string; email: string | null;
  displayName: string; pronouns: string; dateOfBirth: string | null; age: number | null;
  bio: string; interests: string[]; prompts: Prompt[];
  intention: Intention | null; interestedIn: InterestedIn[]; ageMin: number; ageMax: number; maxDistanceKm: number | null;
  areaLabel: string; socialVisibility: SocialVisibility; datingDiscoverable: boolean;
  photos: AccountPhoto[];
  onboarding: { currentStep: Step; completedAt: string | null };
}

export interface BasicsInput { displayName: string; dateOfBirth: string; pronouns: string }
export interface AboutInput { bio: string; interests: string[]; prompts: Prompt[] }
export interface PreferencesInput { intention: Intention | null; interestedIn: InterestedIn[]; ageMin: number; ageMax: number; maxDistanceKm: number | null }
export interface PrivacyInput { areaLabel: string; socialVisibility: SocialVisibility; datingDiscoverable: boolean }
export interface Drafts { basics: BasicsInput; about: AboutInput; preferences: PreferencesInput; privacy: PrivacyInput }
export type FieldErrors = Record<string, string>;

export function draftsFromAccount(a: Account): Drafts {
  return {
    basics: { displayName: a.displayName, dateOfBirth: a.dateOfBirth ?? '', pronouns: a.pronouns },
    about: { bio: a.bio, interests: [...a.interests], prompts: a.prompts.map((p) => ({ ...p })) },
    preferences: { intention: a.intention, interestedIn: [...a.interestedIn], ageMin: a.ageMin, ageMax: a.ageMax, maxDistanceKm: a.maxDistanceKm },
    privacy: { areaLabel: a.areaLabel, socialVisibility: a.socialVisibility, datingDiscoverable: a.datingDiscoverable },
  };
}

// eslint-disable-next-line no-control-regex -- rejecting control characters is the purpose of this check
const CONTROL = /[\u0000-\u001f\u007f]/;
const COORDS = /\d{1,3}\.\d{3,}/;

export function validateBasics(i: BasicsInput, today = todayLocalIso(), dobLocked = false): FieldErrors {
  const e: FieldErrors = {};
  const n = i.displayName.trim();
  if (!n) e.displayName = 'Add the name you want people to see.';
  else if (n.length > ACCOUNT_LIMITS.name) e.displayName = `Keep your name under ${ACCOUNT_LIMITS.name} characters.`;
  else if (CONTROL.test(n)) e.displayName = 'Remove special control characters from your name.';
  if (!dobLocked) { const d = dobError(i.dateOfBirth, today); if (d) e.dateOfBirth = d; }
  if (i.pronouns.length > ACCOUNT_LIMITS.pronouns) e.pronouns = `Keep pronouns under ${ACCOUNT_LIMITS.pronouns} characters.`;
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

export function validatePrivacy(i: PrivacyInput): FieldErrors {
  const e: FieldErrors = {};
  const a = i.areaLabel.trim();
  if (!a) e.areaLabel = 'Add your city or region.';
  else if (a.length > ACCOUNT_LIMITS.area) e.areaLabel = `Keep this under ${ACCOUNT_LIMITS.area} characters.`;
  else if (COORDS.test(a)) e.areaLabel = 'Use a city or region, not coordinates.';
  else if (CONTROL.test(a)) e.areaLabel = 'Remove special control characters.';
  return e;
}

export interface Missing { step: Step; field: string; label: string }

/** The small, explicit set of required fields. Everything else is optional. */
export function missingRequired(a: Account, today = todayLocalIso()): Missing[] {
  const m: Missing[] = [];
  if (!a.displayName.trim()) m.push({ step: 'basics', field: 'displayName', label: 'Add your display name' });
  if (!a.dateOfBirth || dobError(a.dateOfBirth, today)) m.push({ step: 'basics', field: 'dateOfBirth', label: 'Add your date of birth (18 or over)' });
  if (!a.intention) m.push({ step: 'preferences', field: 'intention', label: 'Choose what you’re looking for' });
  if (a.interestedIn.length === 0) m.push({ step: 'preferences', field: 'interestedIn', label: 'Choose who you’d like to meet' });
  if (a.photos.length < 1) m.push({ step: 'photos', field: 'photos', label: 'Add at least one photo' });
  if (!a.areaLabel.trim()) m.push({ step: 'privacy', field: 'areaLabel', label: 'Add your city or region' });
  return m;
}

/** Where to resume: the saved step, but never past the first step that still lacks a required field. */
export function resumeStep(a: Account, today = todayLocalIso()): Step | null {
  if (a.onboarding.completedAt) return null;
  const first = missingRequired(a, today).map((m) => stepIndex(m.step)).sort((x, y) => x - y)[0];
  const saved = stepIndex(a.onboarding.currentStep);
  const idx = first === undefined ? saved : Math.min(saved, first);
  return STEPS[Math.max(0, idx)]!.id;
}

export function completionPercent(a: Account, today = todayLocalIso()): { percent: number; suggestions: string[] } {
  const required = 6 - missingRequired(a, today).length;
  const extras: [boolean, string][] = [
    [a.bio.trim().length >= 40, 'Write a bio of 40 or more characters'],
    [a.interests.length >= 3, 'Pick 3 or more interests'],
    [a.prompts.length >= 2, 'Answer 2 prompts'],
    [a.photos.length >= 3, 'Add 3 or more photos'],
  ];
  const done = required + extras.filter(([ok]) => ok).length;
  return { percent: Math.round((done / (6 + extras.length)) * 100), suggestions: extras.filter(([ok]) => !ok).map(([, s]) => s) };
}

export const ageFromDob = (dob: string | null, today = todayLocalIso()) => (dob ? ageOn(dob, today) : null);
