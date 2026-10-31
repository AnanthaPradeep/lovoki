// INTEGRATION: the real SupabaseDatingApi and the Phase 4 account methods against the local stack.
import { beforeAll, describe, expect, it } from 'vitest';
import { DatingFailure } from '@lovoki/core';
import { SupabaseAccountApi } from '../../apps/web/src/data/SupabaseAccountApi';
import { SupabaseDatingApi } from '../../apps/web/src/data/SupabaseDatingApi';
import { datingUser, rid, type TestUser } from './harness';

let A: TestUser, B: TestUser; let a: SupabaseDatingApi, b: SupabaseDatingApi;
const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof DatingFailure ? e.code : `other:${String(e)}`; } };

beforeAll(async () => {
  [A, B] = await Promise.all([datingUser('adA', { gender: 'woman', interestedIn: ['men'], place: 'lisbon', interests: ['jazz'] }), datingUser('adB', { gender: 'man', interestedIn: ['women'], place: 'sintra', interests: ['coffee'] })]);
  a = new SupabaseDatingApi(A.sb); b = new SupabaseDatingApi(B.sb);
});

describe('SupabaseDatingApi against the real stack', () => {
  it('discover returns typed cards with a bucket, labelled interests and no private fields', async () => {
    const page = await a.discover(); const c = page.items.find((x) => x.userId === B.id)!;
    expect(c).toMatchObject({ displayName: 'adB', gender: 'man', distanceBucket: '<25', intention: 'long-term', interests: ['Coffee'], pronouns: null });
    expect(c.prompts).toEqual([{ question: 'A perfect Sunday', answer: 'Sunday of adB' }]); expect(c.photoPaths).toHaveLength(1);
    expect(JSON.stringify(c)).not.toMatch(/lat|lng|birth|discoverable|liked/i);
    expect(await a.profile(B.id)).toMatchObject({ isMatch: false, matchId: null }); expect(await a.profile(rid())).toBeNull();
  });
  it('status, like, match, matches and unmatch round-trip', async () => {
    expect(await a.status()).toMatchObject({ paused: false, hasGender: true, hasPlace: true, likesLeft: 50, dailyCap: 50 });
    expect(await a.like(B.id)).toEqual({ matched: false, matchId: null }); expect((await a.status()).likesLeft).toBe(49);
    const r = await b.like(A.id); expect(r.matched).toBe(true);
    const mine = (await a.matches()).items; expect(mine).toHaveLength(1); expect(mine[0]).toMatchObject({ userId: B.id, matchId: r.matchId, displayName: 'adB', pronouns: 'they/them' });
    expect((await a.profile(B.id))).toMatchObject({ isMatch: true, matchId: r.matchId });
    await b.unmatch(r.matchId!); expect((await a.matches()).items).toHaveLength(0); expect(await code(a.unmatch(r.matchId!))).toBe('not_found');
  });
  it('maps database errors to typed failures without leaking database text', async () => {
    expect(await code(a.discover('not-a-cursor'))).toBe('invalid_cursor');
    const P = await datingUser('adPaused', { discoverable: false }); const p = new SupabaseDatingApi(P.sb);
    expect(await code(p.discover())).toBe('paused'); expect(await code(p.like(A.id))).toBe('paused'); expect(await p.status()).toMatchObject({ paused: true });
    try { await p.discover(); } catch (e) { expect((e as Error).message).not.toMatch(/LOVOKI_|postgres|function|violates/i); }
  });
});

describe('account methods for the dating profile', () => {
  it('load reads gender, flags, the rounded place and filters; save methods persist them', async () => {
    const U = await datingUser('adAcct', { place: null, gender: 'non-binary' });
    const acct = new SupabaseAccountApi(U.sb, U.id, U.email);
    expect(await acct.load()).toMatchObject({ gender: 'non-binary', showGender: true, showDistance: true, place: null, filterIntentions: [], filterInterests: [] });
    await acct.saveDatingProfile({ gender: 'man', showGender: false, showDistance: false });
    await acct.savePlace({ label: 'Lisbon, Portugal', lat: 38.723456, lng: -9.139876 });
    await acct.saveFilters({ intentions: ['friends-first'], interests: ['Jazz', 'Coffee'] });
    expect(await acct.load()).toMatchObject({ gender: 'man', showGender: false, showDistance: false, place: { label: 'Lisbon, Portugal', lat: 38.72, lng: -9.14 }, areaLabel: 'Lisbon, Portugal', filterIntentions: ['friends-first'], filterInterests: ['Coffee', 'Jazz'].sort() });
    await acct.clearPlace(); expect((await acct.load()).place).toBeNull();
  });
});
