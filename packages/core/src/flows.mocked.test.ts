// MOCKED tests: in-memory fakes stand in for Supabase. They prove the application logic, not Supabase behaviour.
import { describe, it, expect, vi } from 'vitest';
import {
  AccountFailure, AuthFailure, FakeAccountApi, FakeAuthApi, UserScope, clearStoragePrefix, decideRoute, resumeStep, withRetry, missingRequired, isNetworkError,
} from './index';

const adultDob = (years: number) => { const d = new Date(); return `${d.getFullYear() - years}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const jpeg = (size = 1000) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' });

async function finishOnboarding(api: FakeAccountApi) {
  await api.setUsername(`user${Math.random().toString(36).slice(2, 10)}`); await api.recordConsent('v1');
  await api.saveDatingProfile({ gender: 'man', showGender: true, showDistance: true }); await api.savePlace(2267057);
  await api.saveBasics({ displayName: 'Pradi', dateOfBirth: adultDob(30), pronouns: '' });
  await api.savePreferences({ intention: 'long-term', interestedIn: ['women'], ageMin: 25, ageMax: 40, maxDistanceKm: null });
  await api.savePrivacy({ areaLabel: 'Lisbon', socialVisibility: 'public', datingDiscoverable: true });
  await api.uploadPhoto(jpeg());
}

describe('authentication flow (mocked)', () => {
  it('sign-up gives the same neutral result for new and existing addresses', async () => {
    const auth = new FakeAuthApi();
    const first = await auth.signUp('a@example.com', 'correct horse battery');
    const again = await auth.signUp('a@example.com', 'another long password');
    expect(first).toEqual(again);
    expect(auth.users.size).toBe(1);
  });
  it('cannot log in until the email is confirmed, then can', async () => {
    const auth = new FakeAuthApi();
    await auth.signUp('a@example.com', 'correct horse battery');
    await expect(auth.signIn('a@example.com', 'correct horse battery')).rejects.toMatchObject({ code: 'email_not_confirmed' });
    auth.confirm('a@example.com');
    await expect(auth.signIn('a@example.com', 'wrong password!!')).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(auth.signIn('a@example.com', 'correct horse battery')).resolves.toMatchObject({ email: 'a@example.com' });
  });
  it('wrong password and unknown email give the same error', async () => {
    const auth = new FakeAuthApi();
    await auth.signUp('a@example.com', 'correct horse battery'); auth.confirm('a@example.com');
    const a = await auth.signIn('a@example.com', 'nope nope nope').catch((e) => e);
    const b = await auth.signIn('nobody@example.com', 'nope nope nope').catch((e) => e);
    expect(a.code).toBe(b.code); expect(a.message).toBe(b.message);
  });
  it('sign-out notifies listeners and then routes away from protected screens', async () => {
    const auth = new FakeAuthApi();
    await auth.signUp('a@example.com', 'correct horse battery'); auth.confirm('a@example.com');
    const seen: (string | null)[] = [];
    auth.onChange((u) => seen.push(u?.id ?? null));
    await auth.signIn('a@example.com', 'correct horse battery');
    await auth.signOut();
    expect(seen).toEqual([auth.users.get('a@example.com')!.id, null]);
    expect(decideRoute({ mode: 'supabase', path: '/me', auth: 'signed-out', account: 'idle', onboardingComplete: null }).kind).toBe('redirect');
  });
});

describe('email-link callback and password update (mocked)', () => {
  it('a valid link confirms and signs in; a reused or foreign link is expired', async () => {
    const auth = new FakeAuthApi();
    await auth.signUp('a@example.com', 'correct horse battery');
    await expect(auth.completeCallback('https://x.test/auth/callback?code=garbage')).rejects.toMatchObject({ code: 'expired_link' });
    await expect(auth.completeCallback('https://x.test/auth/callback')).rejects.toMatchObject({ code: 'expired_link' });
    const r = await auth.completeCallback('https://x.test/auth/callback?code=ok:a@example.com&next=%2Freset-password');
    expect(r.next).toBe('/reset-password');
    expect(auth.current?.email).toBe('a@example.com');
  });
  it('updating the password needs a session and refuses weak or unchanged passwords', async () => {
    const auth = new FakeAuthApi();
    await auth.signUp('a@example.com', 'correct horse battery');
    await expect(auth.updatePassword('brand new password')).rejects.toMatchObject({ code: 'session_expired' });
    await auth.completeCallback('https://x.test/cb?code=ok:a@example.com');
    await expect(auth.updatePassword('short')).rejects.toMatchObject({ code: 'weak_password' });
    await expect(auth.updatePassword('correct horse battery')).rejects.toMatchObject({ code: 'same_password' });
    await expect(auth.updatePassword('brand new password')).resolves.toBeUndefined();
  });
});

describe('retry behaviour', () => {
  const noWait = async () => undefined;
  it('retries transient network failures with backoff, then succeeds', async () => {
    const delays: number[] = [];
    let n = 0;
    const r = await withRetry(async () => { if (++n < 3) throw new AccountFailure('network', 'down'); return 'ok'; }, { retries: 2, baseMs: 100, sleep: async (ms) => { delays.push(ms); } });
    expect(r).toBe('ok'); expect(n).toBe(3); expect(delays).toEqual([100, 200]);
  });
  it('gives up after the retry budget', async () => {
    const fn = vi.fn(async () => { throw new AuthFailure('network', 'down'); });
    await expect(withRetry(fn, { retries: 2, sleep: noWait })).rejects.toMatchObject({ code: 'network' });
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it.each([['invalid'], ['under_18'], ['unauthorized'], ['onboarding_incomplete']] as const)('does not retry %s failures', async (code) => {
    const fn = vi.fn(async () => { throw new AccountFailure(code, 'x'); });
    await expect(withRetry(fn, { sleep: noWait })).rejects.toBeInstanceOf(AccountFailure);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('treats only network errors as retryable', () => {
    expect(isNetworkError(new AuthFailure('network', 'x'))).toBe(true);
    expect(isNetworkError(new AuthFailure('rate_limited', 'x'))).toBe(false);
    expect(isNetworkError(new Error('x'))).toBe(false);
  });
  it('a failed load recovers on retry with the fake account API', async () => {
    const api = new FakeAccountApi(); api.failNext('network', 1);
    await expect(withRetry(() => api.load(), { sleep: noWait })).resolves.toMatchObject({ userId: api.account.userId });
    expect(api.calls.filter((c) => c === 'load')).toHaveLength(2);
  });
});

describe('onboarding persistence and resume (mocked)', () => {
  it('server-side rules: under 18 refused, exactly 18 accepted', async () => {
    const api = new FakeAccountApi();
    await expect(api.saveBasics({ displayName: 'Kid', dateOfBirth: adultDob(17), pronouns: '' })).rejects.toMatchObject({ code: 'under_18' });
    await expect(api.saveBasics({ displayName: 'Adult', dateOfBirth: adultDob(18), pronouns: '' })).resolves.toBeUndefined();
  });
  it('a refresh mid-way resumes at the saved step with saved data intact', async () => {
    const api = new FakeAccountApi();
    await api.saveBasics({ displayName: 'Pradi', dateOfBirth: adultDob(30), pronouns: '' });
    await api.setStep('preferences');
    const reloaded = await api.load(); // what a refresh or a new login does
    expect(reloaded.displayName).toBe('Pradi');
    expect(resumeStep(reloaded), 'held back to the first missing required step (username and gender)').toBe('basics');
  });
  it('resume is held back to the first step with a missing required field', async () => {
    const api = new FakeAccountApi();
    await api.saveBasics({ displayName: 'Pradi', dateOfBirth: adultDob(30), pronouns: '' });
    await api.setStep('review');
    expect(resumeStep(await api.load())).toBe('basics');
  });
  it('cannot complete with missing fields, and the failure names them', async () => {
    const api = new FakeAccountApi();
    await expect(api.completeOnboarding()).rejects.toMatchObject({ code: 'onboarding_incomplete', missing: expect.arrayContaining(['photos', 'displayName']) });
    expect((await api.load()).onboarding.completedAt).toBeNull();
  });
  it('completes once required fields exist; the date of birth then locks', async () => {
    const api = new FakeAccountApi();
    await finishOnboarding(api);
    expect(missingRequired(await api.load())).toEqual([]);
    expect(await api.completeOnboarding()).toBeTruthy();
    await expect(api.saveBasics({ displayName: 'Pradi', dateOfBirth: adultDob(40), pronouns: '' })).rejects.toMatchObject({ code: 'dob_locked' });
    await expect(api.saveBasics({ displayName: 'Pradi R', dateOfBirth: adultDob(30), pronouns: '' })).resolves.toBeUndefined();
    expect(resumeStep(await api.load())).toBeNull();
  });
  it('profile edits persist across a reload and a "new session"', async () => {
    const api = new FakeAccountApi();
    await finishOnboarding(api);
    await api.saveAbout({ bio: 'Hello there', interests: ['Cooking'], prompts: [{ question: 'A perfect Sunday', answer: 'Slow coffee' }] });
    const next = await api.load();
    expect(next).toMatchObject({ bio: 'Hello there', interests: ['Cooking'] });
    expect(next.prompts).toHaveLength(1);
  });
});

describe('photo restrictions (mocked)', () => {
  it('rejects unsupported types and oversize files, accepts a valid one', async () => {
    const api = new FakeAccountApi();
    await expect(api.uploadPhoto(new Blob(['x'], { type: 'image/gif' }))).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.uploadPhoto(new Blob(['x'], { type: 'application/x-msdownload' }))).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.uploadPhoto(jpeg(5 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.uploadPhoto(jpeg())).resolves.toMatchObject({ position: 0 });
  });
  it('limits to six photos', async () => {
    const api = new FakeAccountApi();
    for (let i = 0; i < 6; i++) await api.uploadPhoto(jpeg());
    await expect(api.uploadPhoto(jpeg())).rejects.toMatchObject({ code: 'photo_limit' });
  });
  it('reorders, makes primary, deletes, and refuses stale or foreign id lists', async () => {
    const api = new FakeAccountApi();
    const [a, b, c] = [await api.uploadPhoto(jpeg()), await api.uploadPhoto(jpeg()), await api.uploadPhoto(jpeg())];
    await api.reorderPhotos([c.id, a.id, b.id]);
    expect((await api.load()).photos.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
    await expect(api.reorderPhotos([a.id])).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.reorderPhotos([a.id, b.id, 'someone-elses'])).rejects.toMatchObject({ code: 'invalid' });
    await api.deletePhoto(c.id);
    expect((await api.load()).photos.map((p) => p.position)).toEqual([0, 1]);
  });
});

describe('logout cleanup of user-scoped state', () => {
  const storage = (keys: string[]) => {
    const m = new Map(keys.map((k) => [k, '1'] as const));
    return { m, get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => { m.delete(k); } };
  };
  it('clears every registered cache and only user-scoped storage keys', () => {
    const s = storage(['lovoki.user.pending-email', 'lovoki.user.resend-until', 'lovoki.ui.theme', 'lovoki.demo.v1', 'lovoki.auth']);
    let account: object | null = { name: 'x' }; const urls = new Map([['p', 'u']]);
    const scope = new UserScope();
    scope.register('account', () => { account = null; });
    scope.register('urls', () => urls.clear());
    expect(clearStoragePrefix(s)).toBe(2);
    expect(scope.clearAll()).toEqual([]);
    expect(account).toBeNull(); expect(urls.size).toBe(0);
    expect([...s.m.keys()].sort()).toEqual(['lovoki.auth', 'lovoki.demo.v1', 'lovoki.ui.theme']); // UI prefs and demo data are untouched
  });
  it('one failing cleaner never blocks the others', () => {
    const scope = new UserScope(); let ran = false;
    scope.register('bad', () => { throw new Error('x'); });
    scope.register('good', () => { ran = true; });
    expect(scope.clearAll()).toEqual(['bad']); expect(ran).toBe(true);
  });
  it('an unregistered cleaner no longer runs', () => {
    const scope = new UserScope(); let n = 0;
    const off = scope.register('x', () => { n++; }); off(); scope.clearAll();
    expect(n).toBe(0);
  });
});
