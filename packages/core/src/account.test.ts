import { describe, it, expect } from 'vitest';
import {
  accountFromRows, completionPercent, draftsFromAccount, missingRequired, resumeStep, validateAbout, validateBasics, validatePreferences, validatePrivacy,
  emptyDetails, validateDetails, type Account, type AccountRows, type BasicsInput,
} from './index';

const TODAY = '2026-10-31';
const blank = (): Account => ({
  userId: 'u1', email: 'a@example.com', displayName: '', pronouns: '', dateOfBirth: null, age: null, bio: '', interests: [], prompts: [],
  intention: null, interestedIn: [], ageMin: 18, ageMax: 60, maxDistanceKm: null, areaLabel: '', socialVisibility: 'public', datingDiscoverable: true,
  photos: [], onboarding: { currentStep: 'basics', completedAt: null },
  username: null, gender: null, genderCustom: null, showGender: true, showDistance: true, place: null, avatarPhotoId: null, avatarCrop: null, details: emptyDetails(), visibility: {},
  allowComments: 'everyone', showFollowerCounts: true, consent: null,
  filterIntentions: [], filterInterests: [], filterHeightMin: null, filterHeightMax: null, filterDrinking: [], filterSmoking: [], filterKids: [],
});
const PLACE = { id: 2267057, name: 'Lisbon', region: 'Lisbon', countryCode: 'PT', country: 'Portugal', label: 'Lisbon, Lisbon, Portugal' };
const B = (o: Partial<BasicsInput> = {}): BasicsInput => ({ displayName: 'Pradi', dateOfBirth: '1996-04-18', pronouns: '', username: 'pradi.r', gender: 'man', genderCustom: '', ...o });
const photo = (n: number) => ({ id: `p${n}`, path: `u1/p${n}.jpg`, position: n, contentType: 'image/jpeg', sizeBytes: 1000 });
const filled = (): Account => ({ ...blank(), displayName: 'Pradi', username: 'pradi.r', gender: 'man', consent: { termsVersion: 'v1', marketing: false }, place: PLACE, dateOfBirth: '1996-04-18', age: 30, intention: 'long-term', interestedIn: ['women'], areaLabel: 'Lisbon', photos: [photo(0)] });

describe('validation', () => {
  it('basics: name, adult date of birth, pronouns', () => {
    expect(validateBasics(B(), TODAY)).toEqual({});
    const e = validateBasics(B({ displayName: '  ', dateOfBirth: '2012-01-01', pronouns: 'x'.repeat(31) }), TODAY);
    expect(Object.keys(e).sort()).toEqual(['dateOfBirth', 'displayName', 'pronouns']);
    expect(validateBasics(B({ displayName: 'x'.repeat(41) }), TODAY).displayName).toMatch(/under 40/);
    expect(validateBasics(B({ displayName: 'A\u0007B' }), TODAY).displayName).toBeTruthy();
  });
  it('basics: date of birth is not re-validated once locked', () => {
    expect(validateBasics(B({ displayName: 'P', dateOfBirth: '' }), TODAY, true)).toEqual({});
  });
  it('basics: username and gender are required, with a custom label when self-describing', () => {
    expect(validateBasics(B({ username: '' }), TODAY).username).toBeTruthy(); expect(validateBasics(B({ username: 'ab' }), TODAY).username).toMatch(/at least 3/);
    expect(validateBasics(B({ username: 'admin' }), TODAY).username).toMatch(/reserved/); expect(validateBasics(B({ username: 'a..b' }), TODAY).username).toBeTruthy();
    expect(validateBasics(B({ username: '@Ok.Name' }), TODAY)).toEqual({});
    expect(validateBasics(B({ gender: '' }), TODAY).gender).toBeTruthy();
    expect(validateBasics(B({ gender: 'self-describe', genderCustom: '' }), TODAY).genderCustom).toBeTruthy();
    expect(validateBasics(B({ gender: 'self-describe', genderCustom: 'x'.repeat(31) }), TODAY).genderCustom).toMatch(/under 30/);
    expect(validateBasics(B({ gender: 'self-describe', genderCustom: 'Genderfluid' }), TODAY)).toEqual({});
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
  it('privacy: a place from the list is required, never typed coordinates', () => {
    expect(validatePrivacy({ place: PLACE, socialVisibility: 'public', datingDiscoverable: true })).toEqual({});
    expect(validatePrivacy({ place: null, socialVisibility: 'public', datingDiscoverable: true }).place).toBeTruthy();
  });
  it('optional details: ranges and fixed lists, nothing sensitive accepted by accident', () => {
    const d = emptyDetails();
    expect(validateDetails(d)).toEqual({});
    expect(validateDetails({ ...d, heightCm: 119 }).heightCm).toBeTruthy(); expect(validateDetails({ ...d, heightCm: 231 }).heightCm).toBeTruthy(); expect(validateDetails({ ...d, heightCm: 180.5 }).heightCm).toBeTruthy();
    expect(validateDetails({ ...d, heightCm: 175, instagramHandle: '@Foo.Bar' })).toEqual({}); expect(validateDetails({ ...d, instagramHandle: 'a b' }).instagramHandle).toBeTruthy();
    expect(validateDetails({ ...d, jobTitle: 'x'.repeat(61) }).jobTitle).toBeTruthy(); expect(validateDetails({ ...d, languages: ['xx'] }).languages).toBeTruthy();
    expect(validateDetails({ ...d, languages: ['ta', 'ml', 'hi', 'te', 'kn', 'en'] })).toEqual({}); expect(validateDetails({ ...d, diet: 'carnivore' }).diet).toBeTruthy();
    expect(validateDetails({ ...d, diet: 'eggetarian', drinking: 'socially', pets: ['dog'], wantsKids: 'open', religion: 'jain' })).toEqual({});
  });
});

describe('required fields and resuming onboarding', () => {
  it('lists exactly the small required set', () => {
    expect(missingRequired(blank(), TODAY).map((m) => m.field).sort()).toEqual(['consent', 'dateOfBirth', 'displayName', 'gender', 'intention', 'interestedIn', 'photos', 'place', 'username']);
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
    expect(resumeStep({ ...filled(), onboarding: { currentStep: 'preferences', completedAt: null } }, TODAY)).toBe('preferences');
  });
  it('a brand new account starts at basics; a completed one does not resume', () => {
    expect(resumeStep(blank(), TODAY)).toBe('basics');
    expect(resumeStep({ ...filled(), onboarding: { currentStep: 'review', completedAt: '2026-10-01T00:00:00Z' } }, TODAY)).toBeNull();
  });
  it('completion percentage rises with optional detail and never pushes religion', () => {
    const base = completionPercent(filled(), TODAY);
    const rich = completionPercent({ ...filled(), bio: 'x'.repeat(50), interests: ['Cooking', 'Music', 'Film'], prompts: [{ question: 'A', answer: 'b' }, { question: 'C', answer: 'd' }], photos: [photo(0), photo(1), photo(2)],
      avatarPhotoId: 'p0', details: { ...emptyDetails(), heightCm: 170, languages: ['ta'], drinking: 'never', hasKids: 'no', instagramHandle: 'x' } }, TODAY);
    expect(base.percent).toBeLessThan(rich.percent); expect(rich.percent).toBe(100); expect(rich.suggestions).toEqual([]);
    expect(base.cards.length).toBeGreaterThan(5); expect(JSON.stringify(base.cards)).not.toMatch(/religion/i);
    expect(completionPercent(blank(), TODAY).percent).toBeLessThan(base.percent);
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
