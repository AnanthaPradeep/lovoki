// UNIT and MOCKED tests for Phase 3.5 logic (profile model, usernames, places, account security). They prove helpers and the fakes' contract, not the database.
import { describe, expect, it } from 'vitest';
import {
  AuthFailure, DEFAULT_VISIBILITY, FakeAccountApi, FakeAuthApi, LANGUAGES, RESERVED_HANDLES, TERMS_VERSION, areaLabelOf, describeDetails, detailsPatch, emptyDetails,
  fakeNearestPlaces, fakeSearchPlaces, genderLabel, handleFromPath, labelOf, normalizeHandle, validateUsername, visibilityOf, DIET, wantsGender,
} from './index';

describe('usernames (client-side hints)', () => {
  it('accepts 3 to 30 of a-z 0-9 . _ without leading, trailing or doubled dots, ignoring @ and case', () => {
    for (const ok of ['abc', 'a.b_c', 'x'.repeat(30), '@Pradi.R', '  Name_1  ']) expect(validateUsername(ok), ok).toBeNull();
    for (const bad of ['', 'ab', 'x'.repeat(31), 'a b', '.a.b', 'a.b.', 'a..b', 'emo😀', 'dash-ed', 'UPPER CASE']) expect(validateUsername(bad), bad).not.toBeNull();
    expect(normalizeHandle(' @Foo.Bar ')).toBe('foo.bar');
  });
  it('refuses reserved words in any case and covers the routes it must protect', () => {
    for (const r of ['admin', 'LOVOKI', 'Support', 'privacy', 'terms', 'feed']) expect(validateUsername(r), r).toMatch(/reserved/);
    for (const r of ['admin', 'support', 'lovoki', 'terms', 'privacy', 'feed', 'discover', 'settings', 'me']) expect(RESERVED_HANDLES).toContain(r);
  });
  it('recognises a profile address like /@handle and nothing else', () => {
    expect(handleFromPath('@Pradi.R')).toBe('pradi.r'); expect(handleFromPath('pradi')).toBeNull(); expect(handleFromPath('@a')).toBeNull(); expect(handleFromPath('@admin')).toBeNull(); expect(handleFromPath('feed')).toBeNull();
  });
});

describe('details model', () => {
  it('defaults: matches-only for instagram and work, private religion, public for the rest', () => {
    expect(DEFAULT_VISIBILITY).toMatchObject({ instagram: 'M', work: 'M', religion: 'X', height: 'P', education: 'P', languages: 'P', lifestyle: 'P', kids: 'P', structure: 'P' });
    expect(visibilityOf({ height: 'F' }, 'height')).toBe('F'); expect(visibilityOf({}, 'religion')).toBe('X');
  });
  it('religion is only put in a patch with an explicit opt-in', () => {
    const d = { ...emptyDetails(), religion: 'jain' };
    expect(detailsPatch(d, { religionOptIn: false })).not.toHaveProperty('religion');
    expect(detailsPatch(d, { religionOptIn: true })).toMatchObject({ religion: 'jain', religion_optin: true });
    expect(detailsPatch({ ...d, religion: null }, { religionOptIn: false })).toMatchObject({ religion: null });
    expect(detailsPatch({ ...emptyDetails(), instagramHandle: '@Foo.Bar', jobTitle: '  Nurse ' }, { religionOptIn: false })).toMatchObject({ instagram_handle: 'foo.bar', job_title: 'Nurse' });
  });
  it('lists only what is set, in a readable form', () => {
    expect(describeDetails({})).toEqual([]);
    const lines = describeDetails({ height_cm: 175, job_title: 'Nurse', company_or_school: 'City Hospital', languages: ['ta', 'ml'], diet: 'eggetarian', wants_kids: 'open', instagram_handle: 'x.y' });
    expect(lines.map((l) => [l.key, l.value])).toEqual([['height', '175 cm'], ['work', 'Nurse at City Hospital'], ['languages', 'Tamil, Malayalam'], ['diet', 'Eggetarian'], ['kids', 'Open to kids'], ['instagram', '@x.y']]);
  });
  it('catalogs include what the product promised', () => {
    expect(DIET.map((d) => d.id)).toEqual(expect.arrayContaining(['vegetarian', 'eggetarian', 'vegan', 'non-vegetarian']));
    for (const c of ['ta', 'ml', 'hi', 'te', 'kn', 'en']) expect(labelOf(LANGUAGES, c)).toBeTruthy();
  });
  it('gender labels: custom wording for self-describe, nothing when hidden; self-describe matches like non-binary', () => {
    expect(genderLabel('self-describe', 'Genderfluid')).toBe('Genderfluid'); expect(genderLabel('woman')).toBe('Woman'); expect(genderLabel(null)).toBeNull();
    expect(wantsGender('self-describe', ['non-binary'])).toBe(true); expect(wantsGender('self-describe', ['women', 'men'])).toBe(false);
  });
  it('area labels follow the database rule (name, region, at most 80 characters)', () => {
    expect(areaLabelOf({ name: 'Kochi', region: 'Kerala' })).toBe('Kochi, Kerala'); expect(areaLabelOf({ name: 'Singapore', region: '' })).toBe('Singapore'); expect(areaLabelOf({ name: 'Paris', region: 'Paris' })).toBe('Paris');
    expect(areaLabelOf({ name: 'x'.repeat(100), region: '' }).length).toBe(80);
  });
});

describe('fake places directory', () => {
  it('searches by prefix, needs two letters, ignores wildcards, and never exposes coordinates', () => {
    expect(fakeSearchPlaces('lis')[0]).toMatchObject({ name: 'Lisbon' }); expect(fakeSearchPlaces('l')).toEqual([]); expect(fakeSearchPlaces('%%')).toEqual([]);
    expect(JSON.stringify(fakeSearchPlaces('ko'))).not.toMatch(/"lat"|"lng"/); expect(fakeNearestPlaces(9.9, 76.3)[0]).toMatchObject({ name: 'Kochi' });
  });
});

describe('account security (mocked)', () => {
  const signedIn = async () => { const a = new FakeAuthApi(); await a.signUp('a@example.com', 'correct horse battery'); a.confirm('a@example.com'); await a.signIn('a@example.com', 'correct horse battery'); return a; };
  it('changing the password re-authenticates with the current one and refuses weak or unchanged ones', async () => {
    const a = await signedIn();
    await expect(a.changePassword('wrong password!!', 'a brand new passphrase')).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(a.changePassword('correct horse battery', 'short')).rejects.toMatchObject({ code: 'weak_password' });
    await expect(a.changePassword('correct horse battery', 'correct horse battery')).rejects.toMatchObject({ code: 'same_password' });
    await a.changePassword('correct horse battery', 'a brand new passphrase');
    await a.signOut(); await expect(a.signIn('a@example.com', 'correct horse battery')).rejects.toBeInstanceOf(AuthFailure); await expect(a.signIn('a@example.com', 'a brand new passphrase')).resolves.toBeTruthy();
  });
  it('changing the email changes nothing until the new address confirms', async () => {
    const a = await signedIn(); await a.changeEmail('new@example.com');
    expect(a.current?.email).toBe('a@example.com'); expect((await a.sessionInfo())?.pendingEmail).toBe('new@example.com');
    a.confirmEmailChange(); expect(a.current?.email).toBe('new@example.com'); expect((await a.sessionInfo())?.pendingEmail).toBeNull();
  });
  it('log out everywhere ends the session and is counted; session info reports only what is known', async () => {
    const a = await signedIn(); const info = await a.sessionInfo();
    expect(info).toMatchObject({ email: 'a@example.com', provider: 'email' }); expect(Object.keys(info!).sort()).toEqual(['email', 'expiresAt', 'lastSignInAt', 'pendingEmail', 'provider']);
    await a.signOutEverywhere(); expect(a.current).toBeNull(); expect(a.globalSignOuts).toBe(1); expect(await a.sessionInfo()).toBeNull();
  });
  it('CAPTCHA: absent means no requirement; present means a token is required for sign-up and reset and is passed through', async () => {
    const a = new FakeAuthApi();
    await expect(a.signUp('a@example.com', 'correct horse battery')).resolves.toBeTruthy();
    a.captchaRequired = true;
    await expect(a.signUp('b@example.com', 'correct horse battery')).rejects.toMatchObject({ code: 'captcha' });
    await expect(a.requestPasswordReset('b@example.com')).rejects.toMatchObject({ code: 'captcha' });
    await a.signUp('b@example.com', 'correct horse battery', { captchaToken: 'tok', consent: { termsVersion: TERMS_VERSION, confirm18: true, marketing: false } });
    expect(a.lastSignUp?.options).toMatchObject({ captchaToken: 'tok', consent: { termsVersion: TERMS_VERSION, confirm18: true, marketing: false } });
    await expect(a.requestPasswordReset('b@example.com', 'tok')).resolves.toBeUndefined();
  });
});

describe('profile saves (mocked)', () => {
  it('usernames are unique across accounts, case-insensitive, and limited once setup is complete', async () => {
    const a = new FakeAccountApi(); const b = new FakeAccountApi(); const h = `u${Math.random().toString(36).slice(2, 10)}`;
    expect(await a.checkUsername('x')).toBe('invalid'); expect(await a.checkUsername('Admin')).toBe('reserved'); expect(await a.checkUsername(h)).toBe('available');
    await a.setUsername(h); expect(await b.checkUsername(h.toUpperCase())).toBe('unavailable'); await expect(b.setUsername(h)).rejects.toBeTruthy(); expect(await a.checkUsername(h)).toBe('available');
    a.account.onboarding.completedAt = new Date().toISOString(); await a.setUsername(h + 'x'); await expect(a.setUsername(h + 'y')).rejects.toBeTruthy();
  });
  it('religion needs an opt-in and clearing it resets its visibility; optional fields never block anything', async () => {
    const api = new FakeAccountApi(); const d = { ...emptyDetails(), religion: 'jain' };
    await expect(api.saveDetails(d, {}, { religionOptIn: false })).rejects.toBeTruthy();
    await api.saveDetails(d, { religion: 'P' }, { religionOptIn: true }); expect((await api.load()).visibility.religion).toBe('P');
    await api.saveDetails({ ...d, religion: null }, {}, { religionOptIn: false }); expect((await api.load()).visibility).not.toHaveProperty('religion');
    await expect(api.saveDetails({ ...emptyDetails(), heightCm: 50 }, {}, { religionOptIn: false })).rejects.toBeTruthy();
  });
  it('consent, places and avatar', async () => {
    const api = new FakeAccountApi(); expect((await api.load()).consent).toBeNull(); await expect(api.recordConsent(' ')).rejects.toBeTruthy();
    await api.recordConsent(TERMS_VERSION); await api.setMarketingConsent(true); expect((await api.load()).consent).toEqual({ termsVersion: TERMS_VERSION, marketing: true });
    await api.savePlace(2267057); expect((await api.load()).place).toMatchObject({ name: 'Lisbon' }); expect(JSON.stringify((await api.load()).place)).not.toMatch(/"lat"|"lng"/); await expect(api.savePlace(-1)).rejects.toBeTruthy();
    await expect(api.saveAvatar('nope', { x: 0.5, y: 0.5, zoom: 1 })).rejects.toBeTruthy();
  });
});
