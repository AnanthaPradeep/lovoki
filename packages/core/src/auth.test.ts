import { describe, it, expect } from 'vitest';
import { classifyPath, decideRoute, mapAuthError, safeCallbackNext, safeRedirect, validateEmail, validatePassword, AuthFailure, type GuardInput } from './index';

describe('email and password validation', () => {
  it('validates email shape', () => {
    for (const ok of ['a@b.co', 'first.last+tag@example.com']) expect(validateEmail(ok)).toBeNull();
    for (const bad of ['', ' ', 'a', 'a@b', '@b.com', 'a b@c.com', 'a@b.c', `${'x'.repeat(250)}@b.com`]) expect(validateEmail(bad)).not.toBeNull();
  });
  it('requires length, rejects trivial and email-derived passwords, respects the 72-byte limit', () => {
    expect(validatePassword('correct horse battery')).toBeNull();
    expect(validatePassword('short')).toMatch(/at least 10/);
    expect(validatePassword('aaaaaaaaaaaa')).toMatch(/variety/);
    expect(validatePassword('pradeep-2026-ok', 'pradeep@example.com')).toMatch(/email name/);
    expect(validatePassword('x'.repeat(73))).toMatch(/72 bytes/);
    expect(validatePassword('é'.repeat(37))).toMatch(/72 bytes/); // 74 bytes
    expect(validatePassword('')).toBe('Enter a password.');
  });
});

describe('auth error mapping', () => {
  const code = (e: unknown) => mapAuthError(e).code;
  it.each([
    [{ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }, 'invalid_credentials'],
    [{ message: 'Invalid login credentials' }, 'invalid_credentials'],
    [{ code: 'email_not_confirmed', message: 'Email not confirmed' }, 'email_not_confirmed'],
    [{ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, 'network'],
    [new TypeError('Failed to fetch'), 'network'],
    [{ status: 429, message: 'x' }, 'rate_limited'],
    [{ code: 'over_email_send_rate_limit' }, 'rate_limited'],
    [{ code: 'otp_expired' }, 'expired_link'],
    [{ code: 'flow_state_not_found' }, 'expired_link'],
    [{ code: 'bad_code_verifier' }, 'expired_link'],
    [{ message: 'Email link is invalid or has expired' }, 'expired_link'],
    [{ code: 'weak_password', message: 'Password should be at least 6 characters' }, 'weak_password'],
    [{ code: 'same_password' }, 'same_password'],
    [{ code: 'user_already_exists' }, 'already_registered'],
    [{ code: 'session_not_found' }, 'session_expired'],
    [{ status: 401, message: 'JWT expired' }, 'session_expired'],
    [{ message: 'something unexpected' }, 'unknown'],
    [null, 'unknown'], [undefined, 'unknown'], ['text', 'unknown'],
  ])('%j -> %s', (raw, expected) => expect(code(raw)).toBe(expected));
  it('never leaks raw backend text', () => {
    const f = mapAuthError({ message: 'duplicate key value violates unique constraint "users_email_key" at 10.0.0.5' });
    expect(f.message).not.toMatch(/duplicate|users_email_key|10\.0/);
  });
  it('passes through existing failures unchanged', () => { const f = new AuthFailure('network', 'm'); expect(mapAuthError(f)).toBe(f); });
});

describe('redirect safety', () => {
  it.each(['/discover', '/me', '/me/edit', '/messages/abc', '/u/maya', '/settings', '/onboarding/photos', '/discover?x=1'])('allows %s', (p) => expect(safeRedirect(p, '/fallback')).toBe(p));
  it.each([
    'https://evil.example', 'http://evil.example/discover', '//evil.example', '///evil.example', '/\\evil.example', '\\\\evil.example', 'javascript:alert(1)',
    'data:text/html,hi', '/%2F%2Fevil.example', '/discover/../../evil', '/discoverx', '/mex', '/login', '/auth/callback', '/reset-password', 'discover', '', ' /discover',
    '/discover\n', '/discover\u0000', `/${'a'.repeat(400)}`,
  ])('rejects %j', (p) => expect(safeRedirect(p, '/fallback')).toBe('/fallback'));
  it('rejects null and undefined', () => { expect(safeRedirect(null, '/f')).toBe('/f'); expect(safeRedirect(undefined, '/f')).toBe('/f'); });
  it('does not preserve a hash, which could carry tokens', () => { expect(safeRedirect('/me#access_token=abc', '/f')).toBe('/me'); });
  it('callback destinations: the reset form or an allowed path, otherwise onboarding', () => {
    expect(safeCallbackNext('/reset-password')).toBe('/reset-password');
    expect(safeCallbackNext('/me')).toBe('/me');
    expect(safeCallbackNext('//evil.example')).toBe('/onboarding');
    expect(safeCallbackNext('/reset-password/../login')).toBe('/onboarding');
    expect(safeCallbackNext(null)).toBe('/onboarding');
  });
});

describe('route guard decisions', () => {
  const base: GuardInput = { mode: 'supabase', path: '/me', auth: 'signed-in', emailConfirmed: true, account: 'ready', onboardingComplete: true };
  const d = (o: Partial<GuardInput>) => decideRoute({ ...base, ...o });
  it('classifies paths', () => {
    expect(['/', '/login', '/auth/callback', '/reset-password', '/onboarding', '/onboarding/photos', '/me/edit', '/nope'].map(classifyPath))
      .toEqual(['root', 'public-auth', 'callback', 'recovery', 'onboarding', 'onboarding', 'app', 'unknown']);
  });
  it('waits while the session is being restored (no flash of the wrong screen)', () => {
    expect(d({ auth: 'loading' })).toEqual({ kind: 'wait' });
    expect(d({ auth: 'loading', path: '/login' })).toEqual({ kind: 'wait' });
  });
  it('always lets the email callback run', () => {
    for (const auth of ['loading', 'signed-out', 'signed-in'] as const) expect(d({ auth, path: '/auth/callback' })).toEqual({ kind: 'allow' });
  });
  it('signed out: public auth pages open, everything private goes to login with a validated next', () => {
    for (const p of ['/welcome', '/signup', '/login', '/forgot-password', '/check-email']) expect(d({ auth: 'signed-out', account: 'idle', path: p })).toEqual({ kind: 'allow' });
    expect(d({ auth: 'signed-out', account: 'idle', path: '/me' })).toEqual({ kind: 'redirect', to: '/login?next=%2Fme' });
    expect(d({ auth: 'signed-out', account: 'idle', path: '/onboarding/photos' })).toEqual({ kind: 'redirect', to: '/login?next=%2Fonboarding%2Fphotos' });
    expect(d({ auth: 'signed-out', account: 'idle', path: '/' })).toEqual({ kind: 'redirect', to: '/welcome' });
    expect(d({ auth: 'signed-out', account: 'idle', path: '/reset-password' })).toEqual({ kind: 'redirect', to: '/forgot-password?expired=1' });
    expect(d({ auth: 'signed-out', account: 'idle', path: '/nope' })).toEqual({ kind: 'allow' });
  });
  it('logout prevents access to every protected route', () => {
    for (const p of ['/discover', '/feed', '/connections', '/messages', '/messages/x', '/me', '/me/edit', '/settings', '/u/a', '/onboarding', '/onboarding/basics'])
      expect(d({ auth: 'signed-out', account: 'idle', onboardingComplete: null, path: p }).kind).toBe('redirect');
  });
  it('signed in, onboarding incomplete: app routes redirect to onboarding; onboarding is allowed', () => {
    expect(d({ onboardingComplete: false, path: '/discover' })).toEqual({ kind: 'redirect', to: '/onboarding' });
    expect(d({ onboardingComplete: false, path: '/me/edit' })).toEqual({ kind: 'redirect', to: '/onboarding' });
    expect(d({ onboardingComplete: false, path: '/onboarding/about' })).toEqual({ kind: 'allow' });
    expect(d({ onboardingComplete: false, path: '/login' })).toEqual({ kind: 'redirect', to: '/onboarding' });
    expect(d({ onboardingComplete: false, path: '/' })).toEqual({ kind: 'redirect', to: '/onboarding' });
  });
  it('signed in and complete: app allowed; auth pages and onboarding bounce to the app', () => {
    expect(d({ path: '/me' })).toEqual({ kind: 'allow' });
    expect(d({ path: '/signup' })).toEqual({ kind: 'redirect', to: '/discover' });
    expect(d({ path: '/onboarding/basics' })).toEqual({ kind: 'redirect', to: '/discover' });
    expect(d({ path: '/' })).toEqual({ kind: 'redirect', to: '/discover' });
  });
  it('honours only a validated ?next= after login', () => {
    expect(d({ path: '/login', search: '?next=%2Fme%2Fedit' })).toEqual({ kind: 'redirect', to: '/me/edit' });
    expect(d({ path: '/login', search: '?next=https%3A%2F%2Fevil.example' })).toEqual({ kind: 'redirect', to: '/discover' });
    expect(d({ path: '/login', search: '?next=%2F%2Fevil.example' })).toEqual({ kind: 'redirect', to: '/discover' });
    expect(d({ path: '/signup', search: '?next=%2Fme' })).toEqual({ kind: 'redirect', to: '/discover' });
  });
  it('waits for the account, then reports load errors instead of guessing', () => {
    expect(d({ account: 'loading', onboardingComplete: null })).toEqual({ kind: 'wait' });
    expect(d({ account: 'idle', onboardingComplete: null })).toEqual({ kind: 'wait' });
    expect(d({ account: 'error', onboardingComplete: null })).toEqual({ kind: 'account-error' });
  });
  it('an unconfirmed email is sent to the confirmation screen', () => {
    expect(d({ emailConfirmed: false })).toEqual({ kind: 'redirect', to: '/check-email' });
  });
  it('recovery page is available to a signed-in session even before the account loads', () => {
    expect(d({ path: '/reset-password', account: 'loading', onboardingComplete: null })).toEqual({ kind: 'allow' });
  });
  it('demo mode never shows auth or onboarding', () => {
    for (const p of ['/login', '/signup', '/onboarding/basics', '/welcome', '/']) expect(d({ mode: 'demo', path: p })).toEqual({ kind: 'redirect', to: '/discover' });
    expect(d({ mode: 'demo', path: '/me' })).toEqual({ kind: 'allow' });
  });
});
