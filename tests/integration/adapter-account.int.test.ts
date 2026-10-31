// INTEGRATION: the real SupabaseAuthApi (account security, consent at sign-up) and the Phase 3.5 SupabaseAccountApi methods
// (username, places, details, avatar, settings, consent) against the local stack. Everything here talks to real GoTrue and Postgres.
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { beforeAll, describe, expect, it } from 'vitest';
import { AccountFailure, AuthFailure, TERMS_VERSION, emptyDetails } from '@lovoki/core';
import { SupabaseAuthApi } from '../../apps/web/src/data/SupabaseAuthApi';
import { SupabaseAccountApi } from '../../apps/web/src/data/SupabaseAccountApi';
import { ANON, MAIL, URL_, addProfilePhoto, admin, createUser, datingUser, placeId, type TestUser } from './harness';

const PW = 'correct-horse-battery-1';
const fresh = (key: string) => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false, storageKey: key }, realtime: { transport: WebSocket as never } });
const authCode = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof AuthFailure ? e.code : `other:${String(e)}`; } };
const acctCode = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof AccountFailure ? e.code : `other:${String(e)}`; } };

async function mailTo(address: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const list = (await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + address)}`)).json()) as { messages?: { ID: string }[] };
    const id = list.messages?.[0]?.ID;
    if (id) { const m = (await (await fetch(`${MAIL}/api/v1/message/${id}`)).json()) as { HTML?: string; Text?: string }; return `${m.HTML ?? ''}\n${m.Text ?? ''}`; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no mail arrived for ${address}`);
}

describe('SupabaseAuthApi: account security against real GoTrue', () => {
  let U: TestUser; let auth: SupabaseAuthApi;
  beforeAll(async () => { U = await createUser('secA'); auth = new SupabaseAuthApi(U.sb, 'http://localhost:5173'); });

  it('sessionInfo reports the real session and no invented device list', async () => {
    const s = await auth.sessionInfo();
    expect(s).toMatchObject({ email: U.email.toLowerCase(), provider: 'email', pendingEmail: null });
    expect(s!.lastSignInAt).toBeTruthy(); expect(Object.keys(s!).sort()).toEqual(['email', 'expiresAt', 'lastSignInAt', 'pendingEmail', 'provider']);
  });

  it('changePassword re-authenticates: a wrong current password is refused and nothing changes', async () => {
    expect(await authCode(auth.changePassword('not-the-password-1', 'brand-new-password-1'))).toBe('invalid_credentials');
    expect((await fresh('old').auth.signInWithPassword({ email: U.email, password: PW })).error).toBeNull();
  });

  it('changePassword with the right current password changes it for real, and weak ones are refused', async () => {
    expect(await authCode(auth.changePassword(PW, 'short'))).toBe('weak_password');
    await auth.changePassword(PW, 'brand-new-password-1');
    expect((await fresh('o2').auth.signInWithPassword({ email: U.email, password: PW })).error, 'the old password no longer works').not.toBeNull();
    expect((await fresh('n2').auth.signInWithPassword({ email: U.email, password: 'brand-new-password-1' })).error).toBeNull();
  });

  it('changeEmail keeps the old address until BOTH the old and the new address confirm', async () => {
    const next = `moved-${randomUUID().slice(0, 8)}@lovoki-it.test`;
    await auth.changeEmail(next);
    const mid = await auth.sessionInfo();
    expect(mid).toMatchObject({ email: U.email.toLowerCase(), pendingEmail: next });
    expect((await admin.auth.admin.getUserById(U.id)).data.user!.email, 'the login email is unchanged').toBe(U.email.toLowerCase());
    // Secure email change (double confirmation, the Supabase default): a link goes to BOTH addresses and both must be opened.
    for (const to of [next, U.email.toLowerCase()]) {
      const body = await mailTo(to);
      const link = /href="([^"]*verify[^"]*)"/.exec(body)?.[1]?.replace(/&amp;/g, '&');
      expect(link, `the mail to ${to} has a verify link`).toBeTruthy();
      expect(link).toMatch(/redirect_to=http(s)?%3A%2F%2Flocalhost%3A5173%2Fauth%2Fcallback%3Fnext%3D%252Fsettings/);
      if (to === next) { await fetch(link!, { redirect: 'manual' }); expect((await admin.auth.admin.getUserById(U.id)).data.user!.email, 'one confirmation is not enough').toBe(U.email.toLowerCase()); }
      else await fetch(link!, { redirect: 'manual' });
    }
    for (let i = 0; i < 20; i++) { if ((await admin.auth.admin.getUserById(U.id)).data.user!.email === next) break; await new Promise((r) => setTimeout(r, 200)); }
    expect((await admin.auth.admin.getUserById(U.id)).data.user!.email).toBe(next);
  });

  it('signOutEverywhere revokes OTHER sessions too, not just this one', async () => {
    const V = await createUser('secB'); const other = fresh('other-device');
    expect((await other.auth.signInWithPassword({ email: V.email, password: PW })).error).toBeNull();
    const refresh = (await other.auth.getSession()).data.session!.refresh_token;
    await new SupabaseAuthApi(V.sb, 'http://localhost:5173').signOutEverywhere();
    const r = await fresh('replay').auth.refreshSession({ refresh_token: refresh });
    expect(r.error, 'the other device’s refresh token no longer works').not.toBeNull();
    expect((await V.sb.auth.getSession()).data.session, 'this device is signed out as well').toBeNull();
  });

  it('signUp records consent from the sign-up metadata with the server clock (and nothing else is trusted)', async () => {
    const email = `consent-${randomUUID().slice(0, 8)}@lovoki-it.test`; const sb = fresh('signup');
    await new SupabaseAuthApi(sb, 'http://localhost:5173').signUp(email, PW, { consent: { termsVersion: TERMS_VERSION, confirm18: true, marketing: true } });
    const id = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email)!.id;
    try {
      const row = (await admin.from('consents').select('*').eq('user_id', id).single()).data!;
      expect(row).toMatchObject({ terms_version: TERMS_VERSION, confirmed_18: true, marketing: true });
      expect(Math.abs(Date.now() - Date.parse(row.accepted_at))).toBeLessThan(5 * 60_000);
    } finally { await admin.auth.admin.deleteUser(id); }
  });

  it('signUp without the 18+ confirmation records no consent, so onboarding cannot be finished', async () => {
    const email = `noconsent-${randomUUID().slice(0, 8)}@lovoki-it.test`;
    await new SupabaseAuthApi(fresh('signup2'), 'http://localhost:5173').signUp(email, PW);
    const id = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email)!.id;
    try { expect((await admin.from('consents').select('user_id').eq('user_id', id)).data).toHaveLength(0); } finally { await admin.auth.admin.deleteUser(id); }
  });
});

describe('SupabaseAccountApi: identity and profile methods against the real database', () => {
  let U: TestUser; let acct: SupabaseAccountApi; let other: SupabaseAccountApi;
  beforeAll(async () => {
    U = await createUser('idA', { complete: false }); acct = new SupabaseAccountApi(U.sb, U.id, U.email);
    const O = await createUser('idB', { complete: false }); other = new SupabaseAccountApi(O.sb, O.id, O.email);
  });

  it('checkUsername and setUsername: statuses, uniqueness (case-insensitive) and typed errors', async () => {
    const h = `adp.${randomUUID().slice(0, 6)}`;
    expect(await acct.checkUsername(h)).toBe('available'); expect(await acct.checkUsername('admin')).toBe('reserved'); expect(await acct.checkUsername('a..b')).toBe('invalid');
    await acct.setUsername(h);
    expect(await other.checkUsername(h.toUpperCase()), 'the same handle in capitals is taken for everyone else').toBe('unavailable');
    expect(await acctCode(other.setUsername(h.toUpperCase()))).toBe('invalid');
    expect((await acct.load()).username).toBe(h);
  });

  it('searchPlaces and nearestPlaces return labelled cities without coordinates; savePlace stores only the choice', async () => {
    const hits = await acct.searchPlaces('Lisb'); expect(hits[0]).toMatchObject({ name: 'Lisbon', countryCode: 'PT', country: 'Portugal' });
    expect(JSON.stringify(hits)).not.toMatch(/lat|lng/i);
    const near = await acct.nearestPlaces(38.7223, -9.1393); expect(near[0]!.name).toBe('Lisbon');
    await acct.savePlace(hits[0]!.id!); const a = await acct.load();
    expect(a.place).toMatchObject({ id: hits[0]!.id, name: 'Lisbon' }); expect(JSON.stringify(a)).not.toMatch(/"lat"|"lng"|38\.7/);
    expect(await acctCode(acct.savePlace(99999999))).not.toBeNull();
  });

  it('saveDetails persists values and audiences; load returns them; religion needs the opt-in flag', async () => {
    const d = { ...emptyDetails(), heightCm: 172, jobTitle: 'Illustrator', languages: ['ta', 'en'], drinking: 'socially' as const, religion: 'other' as const };
    await acct.saveDetails(d, {}, { religionOptIn: false }); expect((await acct.load()).details.religion, 'without the opt-in flag religion is never sent').toBeNull();
    await acct.saveDetails(d, { height: 'M', religion: 'X' }, { religionOptIn: true });
    const a = await acct.load();
    expect(a.details).toMatchObject({ heightCm: 172, jobTitle: 'Illustrator', languages: ['en', 'ta'], drinking: 'socially', religion: 'other' });
    expect(a.visibility).toMatchObject({ height: 'M', religion: 'X' });
    expect(await acctCode(acct.saveDetails({ ...d, heightCm: 20 }, {}, { religionOptIn: true }))).toBe('invalid');
  });

  it('saveSocialSettings, recordConsent and setMarketingConsent round-trip', async () => {
    await acct.saveSocialSettings({ allowComments: 'followers', showFollowerCounts: false });
    expect(await acct.load()).toMatchObject({ allowComments: 'followers', showFollowerCounts: false });
    await acct.recordConsent(TERMS_VERSION, false);
    expect((await acct.load()).consent).toMatchObject({ termsVersion: TERMS_VERSION, marketing: false });
    await acct.setMarketingConsent(true); expect((await acct.load()).consent!.marketing).toBe(true);
    await acct.setMarketingConsent(false); expect((await acct.load()).consent!.marketing).toBe(false);
  });

  it('saveAvatar accepts only the user’s own photo and a square-ish crop', async () => {
    const photo = await addProfilePhoto(U); const a = await acct.load(); const p = a.photos.find((x) => x.path === photo.path)!;
    await acct.saveAvatar(p.id, { x: 0.1, y: 0.1, zoom: 1.5 });
    expect(await acct.load()).toMatchObject({ avatarPhotoId: p.id, avatarCrop: { x: 0.1, y: 0.1, zoom: 1.5 } });
    expect(await acctCode(acct.saveAvatar(randomUUID(), null))).not.toBeNull();
    expect(await acctCode(acct.saveAvatar(p.id, { x: 9, y: 9, zoom: 99 }))).not.toBeNull();
  });

  it('a user created through the dating helper loads as a complete, consistent account', async () => {
    const D = await datingUser('idC', { place: 'lisbon', gender: 'woman' }); const a = await new SupabaseAccountApi(D.sb, D.id, D.email).load();
    expect(a).toMatchObject({ gender: 'woman', onboarding: { completedAt: expect.any(String) } }); expect(a.username).toBeTruthy(); expect(a.place!.id).toBe(await placeId('lisbon')); expect(a.consent).not.toBeNull();
  });
});
