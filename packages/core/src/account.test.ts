import { describe, it, expect } from 'vitest';
import {
  accountFromRows, completionPercent, draftsFromAccount, missingRequired, resumeStep, validateAbout, validateBasics, validatePreferences, validatePrivacy,
  type Account, type AccountRows,
} from './index';

const TODAY = '2026-10-31';
const blank = (): Account => ({
  userId: 'u1', email: 'a@example.com', displayName: '', pronouns: '', dateOfBirth: null, age: null, bio: '', interests: [], prompts: [],
  intention: null, interestedIn: [], ageMin: 18, ageMax: 60, maxDistanceKm: null, areaLabel: '', socialVisibility: 'public', datingDiscoverable: true,
  photos: [], onboarding: { currentStep: 'basics', completedAt: null },
});
const photo = (n: number) => ({ id: `p${n}`, path: `u1/p${n}.jpg`, position: n, contentType: 'image/jpeg', sizeBytes: 1000 });
const filled = (): Account => ({ ...blank(), displayName: 'Pradi', dateOfBirth: '1996-04-18', age: 30, intention: 'long-term', interestedIn: ['women'], areaLabel: 'Kochi', photos: [photo(0)] });

describe('validation', () => {
  it('basics: name, adult date of birth, pronouns', () => {
    expect(validateBasics({ displayName: 'Pradi', dateOfBirth: '1996-04-18', pronouns: '' }, TODAY)).toEqual({});
    const e = validateBasics({ displayName: '  ', dateOfBirth: '2012-01-01', pronouns: 'x'.repeat(31) }, TODAY);
    expect(Object.keys(e).sort()).toEqual(['dateOfBirth', 'displayName', 'pronouns']);
    expect(validateBasics({ displayName: 'x'.repeat(41), dateOfBirth: '1996-04-18', pronouns: '' }, TODAY).displayName).toMatch(/under 40/);
    expect(validateBasics({ displayName: 'A\u0007B', dateOfBirth: '1996-04-18', pronouns: '' }, TODAY).displayName).toBeTruthy();
  });
  it('basics: date of birth is not re-validated once locked', () => {
    expect(validateBasics({ displayName: 'P', dateOfBirth: '', pronouns: '' }, TODAY, true)).toEqual({});
  });
  it('about: limits, catalog interests, unique prompts', () => {
    expect(validateAbout({ bio: '', interests: ['Cooking', 'Music'], prompts: [{ question: 'A perfect Sunday', answer: 'Slow coffee' }] })).toEqual({});
    expect(validateAbout({ bio: 'x'.repeat(301), interests: [], prompts: [] }).bio).toMatch(/1 characters over/);
    expect(validateAbout({ bio: '', interests: ['Not a real interest'], prompts: [] }).interests).toMatch(/from the list/);
    expect(validateAbout({ bio: '', interests: ['Cooking', 'Music', 'Film', 'Vinyl', 'Coffee', 'Hiking', 'Poetry', 'Cycling', 'Baking'], prompts: [] }).interests).toMatch(/up to 8/);
    const dup = validateAbout({ bio: '', interests: [], prompts: [{ question: 'A perfect Sunday', answer: 'a' }, { question: 'A perfect Sunday', answer: 'b' }] });
    expect(dup.prompt1).toMatch(/once/);
    expect(validateAbout({ bio: '', interests: [], prompts: [{ question: 'A perfect Sunday', answer: ' ' }] }).prompt0).toMatch(/Answer this prompt/);
    expect(validateAbout({ bio: '', interests: [], prompts: [{ question: 'Invented question', answer: 'x' }] }).prompt0).toMatch(/from the list/);
  });
  it('preferences: adult-only range and optional distance', () => {
    const ok = { intention: 'long-term' as const, interestedIn: ['women' as const], ageMin: 25, ageMax: 40, maxDistanceKm: null };
    expect(validatePreferences(ok)).toEqual({});
    expect(validatePreferences({ ...ok, ageMin: 17 }).ageRange).toBeTruthy();
    expect(validatePreferences({ ...ok, ageMin: 41 }).ageRange).toMatch(/above/);
    expect(validatePreferences({ ...ok, ageMax: 120 }).ageRange).toBeTruthy();
    expect(validatePreferences({ ...ok, ageMin: NaN }).ageRange).toBeTruthy();
    expect(validatePreferences({ ...ok, intention: null }).intention).toBeTruthy();
    expect(validatePreferences({ ...ok, interestedIn: [] }).interestedIn).toBeTruthy();
    expect(validatePreferences({ ...ok, maxDistanceKm: 0 }).maxDistanceKm).toBeTruthy();
    expect(validatePreferences({ ...ok, maxDistanceKm: 25 })).toEqual({});
  });
  it('privacy: a typed area, never coordinates', () => {
    expect(validatePrivacy({ areaLabel: 'Kochi, Kerala', socialVisibility: 'public', datingDiscoverable: true })).toEqual({});
    expect(validatePrivacy({ areaLabel: '', socialVisibility: 'public', datingDiscoverable: true }).areaLabel).toBeTruthy();
    expect(validatePrivacy({ areaLabel: '9.931233, 76.267304', socialVisibility: 'public', datingDiscoverable: true }).areaLabel).toMatch(/not coordinates/);
  });
});

describe('required fields and resuming onboarding', () => {
  it('lists exactly the small required set', () => {
    expect(missingRequired(blank(), TODAY).map((m) => m.field).sort()).toEqual(['areaLabel', 'dateOfBirth', 'displayName', 'intention', 'interestedIn', 'photos']);
    expect(missingRequired(filled(), TODAY)).toEqual([]);
  });
  it('does not require optional or sensitive fields', () => {
    const a = filled(); // no bio, pronouns, interests, prompts, distance
    expect(missingRequired(a, TODAY)).toEqual([]);
  });
  it('an under-18 stored date of birth still counts as missing', () => {
    expect(missingRequired({ ...filled(), dateOfBirth: '2015-01-01' }, TODAY).map((m) => m.field)).toContain('dateOfBirth');
  });
  it('resumes at the saved step', () => {
    expect(resumeStep({ ...filled(), onboarding: { currentStep: 'privacy', completedAt: null } }, TODAY)).toBe('privacy');
  });
  it('never resumes past the first step that still lacks a required field', () => {
    expect(resumeStep({ ...filled(), photos: [], onboarding: { currentStep: 'review', completedAt: null } }, TODAY)).toBe('photos');
    expect(resumeStep({ ...filled(), displayName: '', onboarding: { currentStep: 'privacy', completedAt: null } }, TODAY)).toBe('basics');
  });
  it('resumes earlier than the missing field when the saved step is earlier', () => {
    expect(resumeStep({ ...blank(), onboarding: { currentStep: 'about', completedAt: null } }, TODAY)).toBe('basics');
  });
  it('a brand new account starts at basics; a completed one does not resume', () => {
    expect(resumeStep(blank(), TODAY)).toBe('basics');
    expect(resumeStep({ ...filled(), onboarding: { currentStep: 'review', completedAt: '2026-10-01T00:00:00Z' } }, TODAY)).toBeNull();
  });
  it('completion percentage rises with optional detail', () => {
    const base = completionPercent(filled(), TODAY).percent;
    const rich = completionPercent({ ...filled(), bio: 'x'.repeat(50), interests: ['Cooking', 'Music', 'Film'], prompts: [{ question: 'A', answer: 'b' }, { question: 'C', answer: 'd' }], photos: [photo(0), photo(1), photo(2)] }, TODAY);
    expect(base).toBeLessThan(rich.percent);
    expect(rich.percent).toBe(100);
    expect(rich.suggestions).toEqual([]);
  });
  it('drafts mirror the account and are independent copies', () => {
    const a = { ...filled(), interests: ['Cooking'] };
    const d = draftsFromAccount(a);
    d.about.interests.push('Music');
    expect(a.interests).toEqual(['Cooking']);
    expect(d.basics.dateOfBirth).toBe('1996-04-18');
  });
});

describe('mapping database rows to the account', () => {
  const rows = (over: Partial<AccountRows> = {}): AccountRows => ({
    userId: 'u1', email: 'a@example.com', private: { date_of_birth: '1996-04-18' },
    profile: { display_name: 'Pradi', pronouns: 'he/him', bio: 'Hi', intention: 'long-term', area_label: 'Kochi', social_visibility: 'followers', dating_discoverable: false },
    prefs: { interested_in: ['women', 'martians'], age_min: 25, age_max: 40, max_distance_km: 50 },
    onboarding: { current_step: 'photos', completed_at: null },
    interests: [{ slug: 'street-food' }, { slug: 'cooking' }, { slug: 'nonexistent' }],
    prompts: [{ position: 2, question: 'B', answer: 'two' }, { position: 1, question: 'A', answer: 'one' }],
    photos: [{ id: 'b', storage_path: 'u1/b.jpg', position: 1, content_type: 'image/jpeg', size_bytes: 5 }, { id: 'a', storage_path: 'u1/a.jpg', position: 0, content_type: 'image/jpeg', size_bytes: 5 }],
    ...over,
  });
  it('maps, orders, derives age and drops unknown values', () => {
    const a = accountFromRows(rows(), '2026-10-31');
    expect(a.age).toBe(30);
    expect(a.interests).toEqual(['Cooking', 'Street food']);
    expect(a.prompts.map((p) => p.answer)).toEqual(['one', 'two']);
    expect(a.photos.map((p) => p.id)).toEqual(['a', 'b']);
    expect(a.interestedIn).toEqual(['women']);
    expect(a.socialVisibility).toBe('followers');
    expect(a.onboarding.currentStep).toBe('photos');
  });
  it('tolerates a missing date of birth and unknown enum values', () => {
    const a = accountFromRows(rows({ private: { date_of_birth: null }, onboarding: { current_step: 'bogus', completed_at: null }, profile: { display_name: null, pronouns: '', bio: '', intention: 'weird', area_label: '', social_visibility: 'weird', dating_discoverable: true } }));
    expect(a).toMatchObject({ age: null, dateOfBirth: null, displayName: '', intention: null, socialVisibility: 'public' });
    expect(a.onboarding.currentStep).toBe('basics');
  });
});
