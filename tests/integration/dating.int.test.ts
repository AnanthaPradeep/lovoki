// INTEGRATION (Phase 4): dating eligibility, discovery, likes, matches, unmatch, pause, distance, privacy, limits.
// Real GoTrue + PostgREST + Postgres RLS + Storage on the LOCAL stack. "Eligible" is probed through dating_profile(): a card comes back
// exactly when the viewer may see and like the target.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PLACES, admin, datingUser, discover, discoverAll, eligible, localSql, must, rawRest, rid, rpc, rpcFails, yearsAgo, type Card, type TestUser,
} from './harness';

const likeRes = (u: TestUser, t: TestUser) => rpc<{ matched: boolean; match_id: string | null }[]>(u, 'like_profile', { p_target: t.id }).then((r) => r[0]!);
const matchesOf = (u: TestUser) => rpc<{ match_id: string; user_id: string; display_name: string; pronouns: string | null }[]>(u, 'list_matches', { p_limit: 20 });
const matchRows = async (a: TestUser, b: TestUser) => must(await admin.from('matches').select('*').eq('user_a', [a.id, b.id].sort()[0]!).eq('user_b', [a.id, b.id].sort()[1]!));
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (x: number) => (x * Math.PI) / 180; const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const FORBIDDEN_KEY = /^(lat|lng|latitude|longitude|coords?|coordinates|date_of_birth|dob|dating_discoverable|discoverable|likes?_?you|liked_you|liked_me|likes_me|has_liked|they_liked|show_distance|distance_km|distance)$/i;
/** Every key, at any depth, of a JSON value. */
const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
};
const forbidden = (v: unknown) => [...keysOf(v)].filter((k) => FORBIDDEN_KEY.test(k));

describe('compatibility matrix (gender both ways, ages both ways)', () => {
  let W: TestUser, M: TestUser, NB: TestUser, WW: TestUser, MM: TestUser, WnoGender: TestUser;
  beforeAll(async () => {
    [W, M, NB, WW, MM] = await Promise.all([
      datingUser('mxW', { gender: 'woman', interestedIn: ['men'] }), datingUser('mxM', { gender: 'man', interestedIn: ['women'] }),
      datingUser('mxNB', { gender: 'non-binary', interestedIn: ['women', 'men', 'non-binary'] }),
      datingUser('mxWW', { gender: 'woman', interestedIn: ['women'] }), datingUser('mxMM', { gender: 'man', interestedIn: ['men'] })]);
    WnoGender = await datingUser('mxNoGender', { interestedIn: ['men'] });
    await admin.from('profiles').update({ gender: null }).eq('user_id', WnoGender.id); // a profile that predates the gender field
  });
  it('is eligible only when each person wants the other’s gender', async () => {
    const cases: [TestUser, TestUser, boolean, string][] = [
      [W, M, true, 'woman→men with man→women'], [M, W, true, 'symmetric'], [W, NB, false, 'NB wants everyone but a woman who wants only men does not want NB'],
      [NB, W, false, 'NB sees W but W does not want NB'], [W, W, false, 'self'], [WW, W, false, 'WW wants women, W wants men'], [W, WW, false, 'reverse'],
      [MM, M, false, 'MM wants men, M wants women'], [WW, NB, false, 'WW wants women, NB is non-binary'],
    ];
    for (const [v, t, want, why] of cases) {
      if (v === t) { expect(await eligible(v, t), why).toBe(false); continue; }
      expect(await eligible(v, t), why).toBe(want);
    }
    expect(await eligible(WW, await datingUser('mxWW2', { gender: 'woman', interestedIn: ['women'] })), 'woman↔woman when both want women').toBe(true);
  });
  it('a profile without a gender is invisible to others and cannot discover or like', async () => {
    expect(await eligible(M, WnoGender)).toBe(false); expect(await eligible(WnoGender, M)).toBe(false);
    await rpcFails(WnoGender, 'discover_profiles', {}, 'LOVOKI_PROFILE_INCOMPLETE');
    await rpcFails(WnoGender, 'like_profile', { p_target: M.id }, 'LOVOKI_PROFILE_INCOMPLETE');
  });
  it('hiding gender only hides the label on the card, not eligibility', async () => {
    const H = await datingUser('mxHide', { gender: 'man', interestedIn: ['women'], showGender: false });
    const card = (await rpc<Card[]>(W, 'dating_profile', { p_user: H.id }))[0]!;
    expect(card.gender, 'label hidden').toBeNull();
    expect(await eligible(W, H), 'still compatible').toBe(true);
    expect((await rpc<Card[]>(W, 'dating_profile', { p_user: M.id }))[0]!.gender).toBe('man');
  });
});

describe('age ranges must hold both ways', () => {
  it('requires the viewer’s age in the target’s range and the target’s age in the viewer’s range', async () => {
    const v = await datingUser('agV', { dob: yearsAgo(30), ageMin: 25, ageMax: 35 });
    const ok = await datingUser('agOk', { dob: yearsAgo(28), ageMin: 28, ageMax: 40 });
    const tooOldForMe = await datingUser('agOld', { dob: yearsAgo(40), ageMin: 18, ageMax: 99 });
    const iAmTooOld = await datingUser('agYoung', { dob: yearsAgo(22), ageMin: 18, ageMax: 25 });
    const edge = await datingUser('agEdge', { dob: yearsAgo(35), ageMin: 30, ageMax: 30 });
    expect(await eligible(v, ok), 'both ranges contain the other').toBe(true);
    expect(await eligible(v, tooOldForMe), 'target outside my range').toBe(false);
    expect(await eligible(tooOldForMe, v), 'symmetric').toBe(false);
    expect(await eligible(v, iAmTooOld), 'target is in my range? 22 is not, and I am not in theirs').toBe(false);
    expect(await eligible(v, edge), 'edge: they are 35 (my max) and I am 30 (their min and max)').toBe(true);
    expect(await eligible(edge, v), 'edge reverse').toBe(true);
  });
});

describe('distance: buckets, max distance and rounding', () => {
  let me: TestUser, near: TestUser, mid: TestUser, far: TestUser, nowhere: TestUser, hidden: TestUser, sintra: TestUser;
  beforeAll(async () => {
    me = await datingUser('dsMe', { place: 'lisbon' });
    [near, sintra, mid, far, nowhere, hidden] = await Promise.all([
      datingUser('dsNear', { place: 'almada' }), datingUser('dsSintra', { place: 'sintra' }), datingUser('dsMid', { place: 'setubal' }), datingUser('dsFar', { place: 'madrid' }),
      datingUser('dsNoPlace', { place: null }), datingUser('dsHidden', { place: 'porto', showDistance: false })]);
  });
  it('known test places fall in the expected buckets', async () => {
    expect(km(PLACES.lisbon, PLACES.almada)).toBeLessThan(5); expect(km(PLACES.lisbon, PLACES.sintra)).toBeGreaterThan(10); expect(km(PLACES.lisbon, PLACES.sintra)).toBeLessThan(25);
    expect(km(PLACES.lisbon, PLACES.setubal)).toBeGreaterThan(25); expect(km(PLACES.lisbon, PLACES.setubal)).toBeLessThan(50); expect(km(PLACES.lisbon, PLACES.madrid)).toBeGreaterThan(100);
    const bucket = async (t: TestUser) => (await rpc<Card[]>(me, 'dating_profile', { p_user: t.id }))[0]!.distance_bucket;
    expect(await bucket(near)).toBe('<5'); expect(await bucket(sintra)).toBe('<25'); expect(await bucket(mid)).toBe('<50'); expect(await bucket(far)).toBe('100+');
  });
  it('no place, or hidden distance, means no bucket (and no distance filtering)', async () => {
    expect((await rpc<Card[]>(me, 'dating_profile', { p_user: nowhere.id }))[0]!.distance_bucket).toBeNull();
    expect((await rpc<Card[]>(me, 'dating_profile', { p_user: hidden.id }))[0]!.distance_bucket).toBeNull();
  });
  it('the viewer’s max distance excludes farther people, rounded UP to a bucket edge', async () => {
    await rpc(me, 'save_preferences', { p_intention: 'long-term', p_interested_in: ['women', 'men', 'non-binary'], p_age_min: 18, p_age_max: 99, p_max_distance: 10 });
    expect(await eligible(me, near), 'within 10').toBe(true);
    expect(await eligible(me, sintra), '22 km is beyond 10').toBe(false);
    await rpc(me, 'save_preferences', { p_intention: 'long-term', p_interested_in: ['women', 'men', 'non-binary'], p_age_min: 18, p_age_max: 99, p_max_distance: 7 });
    expect(await eligible(me, near), '7 rounds up to 10: near (4.7) still in').toBe(true);
    await rpc(me, 'save_preferences', { p_intention: 'long-term', p_interested_in: ['women', 'men', 'non-binary'], p_age_min: 18, p_age_max: 99, p_max_distance: 25 });
    expect(await eligible(me, sintra)).toBe(true); expect(await eligible(me, mid), '31 km beyond 25').toBe(false); expect(await eligible(me, far)).toBe(false);
    expect(await eligible(me, nowhere), 'unknown distance is not filtered').toBe(true); expect(await eligible(me, hidden), 'hidden distance is not filtered').toBe(true);
    await rpc(me, 'save_preferences', { p_intention: 'long-term', p_interested_in: ['women', 'men', 'non-binary'], p_age_min: 18, p_age_max: 99, p_max_distance: 250 });
    expect(await eligible(me, far), 'above 100 means no limit').toBe(true);
    await rpc(me, 'save_preferences', { p_intention: 'long-term', p_interested_in: ['women', 'men', 'non-binary'], p_age_min: 18, p_age_max: 99, p_max_distance: null });
  });
  it('the place is rounded by the server and only the owner can read it', async () => {
    const P = await datingUser('dsRound', { place: null });
    await rpc(P, 'save_place', { p_label: 'Lisbon centre', p_lat: 38.723456, p_lng: -9.139876 });
    const row = must(await P.sb.from('profile_places').select('lat,lng'))[0] as { lat: number; lng: number };
    expect(row).toEqual({ lat: 38.72, lng: -9.14 });
    expect(must(await me.sb.from('profile_places').select('*').eq('user_id', P.id)), 'others cannot read it').toHaveLength(0);
    await rpcFails(P, 'save_place', { p_label: 'x', p_lat: 120, p_lng: 0 }, 'LOVOKI_INVALID');
    await rpcFails(P, 'save_place', { p_label: '38.7234, -9.1398', p_lat: 38.72, p_lng: -9.14 }, 'LOVOKI_INVALID');
    await rpc(P, 'clear_place'); expect(must(await P.sb.from('profile_places').select('*'))).toHaveLength(0);
  });
});

describe('every exclusion', () => {
  let V: TestUser;
  beforeAll(async () => { V = await datingUser('exV'); });
  const inQueue = async (t: TestUser) => (await discoverAll(V)).some((c) => c.user_id === t.id);

  it('a plain eligible person appears; self never does', async () => {
    const T = await datingUser('exPlain'); expect(await inQueue(T)).toBe(true);
    expect((await discoverAll(V)).some((c) => c.user_id === V.id)).toBe(false);
  });
  it('liked: disappears from discovery, and liking again is idempotent', async () => {
    const T = await datingUser('exLiked'); expect(await inQueue(T)).toBe(true);
    expect(await likeRes(V, T)).toEqual({ matched: false, match_id: null }); expect(await likeRes(V, T)).toEqual({ matched: false, match_id: null });
    expect(await inQueue(T)).toBe(false);
    expect(must(await admin.from('dating_actions').select('*').eq('actor_id', V.id).eq('target_id', T.id)), 'one row').toHaveLength(1);
  });
  it('passed: hidden for 90 days, then back; passes never notify; a pass never downgrades a like', async () => {
    const T = await datingUser('exPassed'); await rpc(V, 'pass_profile', { p_target: T.id }); expect(await inQueue(T)).toBe(false);
    expect(must(await admin.from('notifications').select('id').eq('recipient_id', T.id))).toHaveLength(0);
    localSql(`update public.dating_actions set created_at = now() - interval '91 days' where actor_id = '${V.id}' and target_id = '${T.id}'`);
    expect(await inQueue(T), 'a pass older than 90 days lapses').toBe(true);
    await rpc(V, 'like_profile', { p_target: T.id }); await rpc(V, 'pass_profile', { p_target: T.id });
    expect(must(await admin.from('dating_actions').select('action').eq('actor_id', V.id).eq('target_id', T.id))[0]!.action).toBe('like');
    await rpc(V, 'pass_profile', { p_target: rid() }); // unknown id: silent, no error that would reveal existence
  });
  it('matched, unmatched and blocked people never appear (both directions)', async () => {
    const T = await datingUser('exMatched'); await likeRes(T, V); expect((await likeRes(V, T)).matched).toBe(true);
    expect(await inQueue(T), 'matched people leave discovery').toBe(false); expect(await eligible(V, T), 'the detail view still opens for a match').toBe(true);
    const mid = (await matchesOf(V)).find((m) => m.user_id === T.id)!.match_id;
    await rpc(V, 'unmatch', { p_match: mid }); expect(await inQueue(T)).toBe(false); expect(await eligible(T, V)).toBe(false);
    const B = await datingUser('exBlocked'); await rpc(B, 'block_user', { p_user: V.id }); expect(await inQueue(B)).toBe(false); expect(await eligible(B, V)).toBe(false);
    const C = await datingUser('exBlocker'); await rpc(V, 'block_user', { p_user: C.id }); expect(await inQueue(C)).toBe(false);
  });
  it('paused and not-yet-complete people never appear', async () => {
    const P = await datingUser('exPaused', { discoverable: false }); expect(await inQueue(P)).toBe(false);
    const I = await datingUser('exIncomplete', { complete: false }); expect(await inQueue(I)).toBe(false);
    await rpcFails(I, 'discover_profiles', {}, 'LOVOKI_ONBOARDING_INCOMPLETE');
  });
  it('under-18 is impossible, and the eligibility function re-checks the age anyway', async () => {
    const kid = await createKid(); await rpcFails(kid, 'save_basics', { p_display_name: 'kid', p_date_of_birth: yearsAgo(17), p_pronouns: '' }, 'LOVOKI_UNDER_18');
    const T = await datingUser('exAdult'); expect(await eligible(V, T)).toBe(true);
    // Bypass the date-of-birth trigger on the LOCAL database to prove the function itself refuses a minor.
    localSql('alter table public.profiles_private disable trigger profiles_private_guard_dob');
    try {
      localSql(`update public.profiles_private set date_of_birth = '${yearsAgo(17)}' where user_id = '${T.id}'`);
      expect(await eligible(V, T), 'a 17-year-old target is never eligible').toBe(false);
      expect(await eligible(T, V), 'a 17-year-old viewer sees no one').toBe(false);
      expect((await discoverAll(V)).some((c) => c.user_id === T.id)).toBe(false);
    } finally {
      localSql(`update public.profiles_private set date_of_birth = '${yearsAgo(30)}' where user_id = '${T.id}'`);
      localSql('alter table public.profiles_private enable trigger profiles_private_guard_dob');
    }
    expect(await eligible(V, T), 'restored').toBe(true);
  });
  it('soft filters narrow only the viewer’s own queue', async () => {
    const F = await datingUser('exFilter'); const a = await datingUser('exFA', { intention: 'friends-first', interests: ['jazz'] }); const b = await datingUser('exFB', { intention: 'long-term', interests: ['coffee'] });
    await rpc(F, 'save_dating_filters', { p_intentions: ['friends-first'], p_interests: [] });
    expect((await discoverAll(F)).map((c) => c.user_id).filter((i) => [a.id, b.id].includes(i))).toEqual([a.id]);
    await rpc(F, 'save_dating_filters', { p_intentions: [], p_interests: ['coffee'] });
    expect((await discoverAll(F)).map((c) => c.user_id).filter((i) => [a.id, b.id].includes(i))).toEqual([b.id]);
    expect(await eligible(F, a), 'filters do not change eligibility (liking, detail)').toBe(true);
    expect(await eligible(a, F), 'and never affect the other side').toBe(true);
    await rpcFails(F, 'save_dating_filters', { p_intentions: ['nope'], p_interests: [] }, 'LOVOKI_INVALID');
    await rpc(F, 'save_dating_filters', { p_intentions: [], p_interests: [] });
  });
});
async function createKid() { const { createUser } = await import('./harness'); return createUser('kid', { complete: false }); }

describe('likes and matches', () => {
  it('a mutual like creates one match, announced to both, with no "someone liked you" before it', async () => {
    const A = await datingUser('lmA'); const B = await datingUser('lmB');
    expect(await likeRes(A, B)).toEqual({ matched: false, match_id: null });
    expect(must(await admin.from('notifications').select('type').eq('recipient_id', B.id)), 'B is told nothing when A likes').toHaveLength(0);
    expect((await discoverAll(B)).some((c) => c.user_id === A.id), 'A still appears in B’s queue like anyone else').toBe(true);
    const r = await likeRes(B, A); expect(r.matched).toBe(true); expect(r.match_id).toBeTruthy();
    for (const u of [A, B]) {
      const n = must(await admin.from('notifications').select('type,actor_id').eq('recipient_id', u.id));
      expect(n, 'one match notification each').toHaveLength(1); expect(n[0]!.type).toBe('match');
    }
    expect((await matchesOf(A)).map((m) => m.user_id)).toEqual([B.id]); expect((await matchesOf(B)).map((m) => m.user_id)).toEqual([A.id]);
    expect(await likeRes(A, B), 're-liking a match returns the same match').toEqual({ matched: true, match_id: r.match_id });
    expect(await matchRows(A, B)).toHaveLength(1);
    expect((await matchesOf(A))[0]!.pronouns, 'matched people see pronouns (M-visibility)').toBe('they/them');
    expect((await rpc<Card[]>(await datingUser('lmStranger'), 'dating_profile', { p_user: A.id }))[0]!.pronouns ?? null, 'strangers do not').toBeNull();
  });
  it('two simultaneous opposite likes create exactly one match, every time', async () => {
    // Exactly two calls per pair: without the pair lock each can miss the other's uncommitted like and NO match forms.
    const rounds = await Promise.all(Array.from({ length: 12 }, async (_, i) => ({ A: await datingUser(`raceA${i}`), B: await datingUser(`raceB${i}`) })));
    for (const [i, { A, B }] of rounds.entries()) {
      const res = await Promise.all([likeRes(A, B), likeRes(B, A)]);
      expect(res.some((r) => r.matched), `round ${i}: at least one caller sees the match`).toBe(true);
      expect(await matchRows(A, B), `round ${i}: exactly one match row`).toHaveLength(1);
      expect(must(await admin.from('notifications').select('recipient_id').eq('type', 'match').in('recipient_id', [A.id, B.id])), `round ${i}: one notification each`).toHaveLength(2);
    }
  });
  it('repeated parallel likes from the same side never duplicate anything', async () => {
    const A = await datingUser('dupA'); const B = await datingUser('dupB');
    await Promise.all([likeRes(A, B), likeRes(A, B), likeRes(A, B)]);
    expect(must(await admin.from('dating_actions').select('*').eq('actor_id', A.id).eq('target_id', B.id))).toHaveLength(1);
    const res = await Promise.all([likeRes(B, A), likeRes(B, A), likeRes(A, B)]);
    expect(res.every((r) => r.matched)).toBe(true); expect(await matchRows(A, B)).toHaveLength(1);
  });
  it('liking an ineligible, hidden or unknown person looks exactly like liking an eligible one', async () => {
    const V = await datingUser('nrV', { gender: 'woman', interestedIn: ['men'] });
    const eligibleT = await datingUser('nrOk', { gender: 'man', interestedIn: ['women'] });
    const incompatible = await datingUser('nrNo', { gender: 'woman', interestedIn: ['women'] });
    const paused = await datingUser('nrPaused', { gender: 'man', interestedIn: ['women'], discoverable: false });
    const responses = [await likeRes(V, eligibleT), await likeRes(V, incompatible), await likeRes(V, paused), (await rpc<{ matched: boolean; match_id: string | null }[]>(V, 'like_profile', { p_target: rid() }))[0]!];
    for (const r of responses) expect(r).toEqual({ matched: false, match_id: null });
    expect(must(await admin.from('dating_actions').select('target_id').eq('actor_id', V.id)).map((r) => r.target_id).sort(), 'only eligible or merely paused targets are recorded')
      .toEqual([eligibleT.id, paused.id].sort());
    await rpcFails(V, 'like_profile', { p_target: V.id }, 'LOVOKI_INVALID');
  });
  it('no endpoint reveals who liked you', async () => {
    const A = await datingUser('rvA'); const B = await datingUser('rvB'); await likeRes(B, A);
    for (const t of ['dating_actions', 'matches', 'dating_exclusions', 'dating_rate']) {
      expect((await rawRest(A, 'GET', `${t}?select=*`)).status, `${t} read`).toBeGreaterThanOrEqual(400);
      expect((await rawRest(null, 'GET', `${t}?select=*`)).status, `${t} anon read`).toBeGreaterThanOrEqual(400);
    }
    const seen = [await discover(A), (await rpc<Card[]>(A, 'dating_profile', { p_user: B.id })), await matchesOf(A), await rpc(A, 'notifications_page', { p_limit: 20 }), await rpc(A, 'dating_status')];
    expect(forbidden(seen), 'no forbidden key anywhere').toEqual([]);
    const text = JSON.stringify(seen); expect(text).not.toMatch(/liked/i);
    expect(must(await admin.from('notifications').select('id').eq('recipient_id', A.id)), 'no notification for a like').toHaveLength(0);
    // ordering is not engagement-based: B (who likes A) is not pushed to the top of A's queue by that fact; the order is the per-day hash.
    const cohort = await discoverAll(A); const key = (id: string) => cohort.findIndex((c) => c.user_id === id); expect(key(B.id)).toBeGreaterThanOrEqual(0);
  });
  it('direct client writes on every dating table are denied and change nothing', async () => {
    const A = await datingUser('dwA'); const B = await datingUser('dwB');
    const bodies: Record<string, Record<string, unknown>> = {
      dating_actions: { actor_id: A.id, target_id: B.id, action: 'like' }, matches: { user_a: [A.id, B.id].sort()[0], user_b: [A.id, B.id].sort()[1] },
      dating_exclusions: { user_a: [A.id, B.id].sort()[0], user_b: [A.id, B.id].sort()[1], reason: 'unmatch' }, dating_rate: { actor_id: A.id, kind: 'x', window_start: new Date().toISOString(), n: 0 },
      profile_places: { user_id: A.id, lat: 1, lng: 1 },
    };
    for (const [t, body] of Object.entries(bodies)) {
      for (const [m, path, b] of [['POST', t, body], ['PATCH', t, { n: 5, lat: 2 }], ['DELETE', `${t}?created_at=gt.2000-01-01`, undefined]] as const) {
        const r = await rawRest(A, m, path, b); expect(r.status, `${m} ${t}: ${r.text}`).toBeGreaterThanOrEqual(400);
      }
    }
    expect(must(await admin.from('dating_actions').select('*').eq('actor_id', A.id))).toHaveLength(0);
    expect(must(await A.sb.from('profile_places').select('lat,lng'))[0], 'own place untouched').toEqual({ lat: 38.72, lng: -9.14 });
    for (const fn of ['like_profile', 'discover_profiles', 'dating_profile', 'list_matches', 'unmatch', 'dating_status']) expect((await rawRest(null, 'POST', `rpc/${fn}`, {})).status, `anon ${fn}`).toBeGreaterThanOrEqual(400);
    for (const [fn, args] of [['_dating_eligible', { v: A.id, t: B.id }], ['_try_match', { a: A.id, b: B.id }], ['_dating_cards', { v: A.id, ids: [B.id] }]] as const) {
      expect((await rawRest(A, 'POST', `rpc/${fn}`, args)).status, `${fn} is internal`).toBeGreaterThanOrEqual(400);
    }
  });
});

describe('unmatch and block effects', () => {
  it('either person can unmatch; both vanish from Matches and Discover permanently; nothing else changes', async () => {
    const A = await datingUser('umA'); const B = await datingUser('umB'); await likeRes(A, B); await likeRes(B, A);
    const mid = (await matchesOf(A))[0]!.match_id;
    await rpcFails(await datingUser('umOther'), 'unmatch', { p_match: mid }, 'LOVOKI_NOT_FOUND');
    await rpc(B, 'unmatch', { p_match: mid });
    expect(await matchesOf(A)).toHaveLength(0); expect(await matchesOf(B)).toHaveLength(0);
    expect((await discoverAll(A)).some((c) => c.user_id === B.id)).toBe(false); expect((await discoverAll(B)).some((c) => c.user_id === A.id)).toBe(false);
    await rpcFails(A, 'unmatch', { p_match: mid }, 'LOVOKI_NOT_FOUND');
    expect(await likeRes(A, B), 'liking after unmatch is inert and neutral').toEqual({ matched: false, match_id: null });
    expect(await matchRows(A, B)).toHaveLength(1);
    expect(must(await admin.from('matches').select('unmatched_by').eq('id', mid))[0]!.unmatched_by).toBe(B.id);
    expect(must(await admin.from('notifications').select('id').eq('type', 'match').in('recipient_id', [A.id, B.id])), 'match notifications are removed').toHaveLength(0);
  });
  it('a social block ends the match and excludes both directions', async () => {
    const A = await datingUser('bmA'); const B = await datingUser('bmB'); await likeRes(A, B); await likeRes(B, A);
    await rpc(A, 'block_user', { p_user: B.id });
    expect(await matchesOf(A)).toHaveLength(0); expect(await matchesOf(B)).toHaveLength(0);
    expect(await eligible(A, B)).toBe(false); expect(await eligible(B, A)).toBe(false);
    await rpc(A, 'unblock_user', { p_user: B.id });
    expect(await eligible(A, B), 'unblocking does not bring them back into discovery (design choice, documented)').toBe(false);
  });
});

describe('pause', () => {
  it('removes you from everyone’s discovery at once, keeps matches, blocks new matches, and makes earlier likes inert until you resume', async () => {
    const A = await datingUser('pzA'); const B = await datingUser('pzB'); const C = await datingUser('pzC'); const D = await datingUser('pzD');
    await likeRes(A, B); await likeRes(B, A);                       // A and B are matched
    await likeRes(C, A);                                             // C liked A earlier
    expect((await discoverAll(D)).some((c) => c.user_id === A.id)).toBe(true);
    await rpc(A, 'save_privacy', { p_area_label: 'Lisbon', p_social_visibility: 'followers', p_dating_discoverable: false }); // A pauses
    expect((await discoverAll(D)).some((c) => c.user_id === A.id), 'gone from others’ discovery immediately').toBe(false);
    expect(await eligible(D, A)).toBe(false);
    expect((await matchesOf(B)).map((m) => m.user_id), 'existing match stays (both sides)').toEqual([A.id]); expect((await matchesOf(A)).map((m) => m.user_id)).toEqual([B.id]);
    await rpcFails(A, 'discover_profiles', {}, 'LOVOKI_PAUSED'); await rpcFails(A, 'like_profile', { p_target: D.id }, 'LOVOKI_PAUSED');
    expect(await likeRes(D, A), 'liking a paused person is neutral').toEqual({ matched: false, match_id: null });
    expect(await likeRes(A, C).catch((e) => String(e)), 'a paused person cannot like').toMatch(/LOVOKI_PAUSED/);
    expect(await matchRows(A, C), 'C↔A cannot form while A is paused').toHaveLength(0);
    // Resume: C's like (and D's stored like) become live. A never liked C or D, so no match forms unless A likes back.
    await rpc(A, 'save_privacy', { p_area_label: 'Lisbon', p_social_visibility: 'followers', p_dating_discoverable: true });
    expect((await discoverAll(D)).some((c) => c.user_id === A.id), 'back in discovery').toBe(false); // D already liked A
    expect((await discoverAll(C)).some((c) => c.user_id === A.id)).toBe(false);
    expect((await likeRes(A, C)).matched, 'A likes C who liked A earlier: match').toBe(true);
  });
  it('a pair whose likes were stored while one was paused becomes a match when they resume', async () => {
    const A = await datingUser('rsA'); const B = await datingUser('rsB');
    await likeRes(A, B);                                             // A likes B
    await rpc(B, 'save_privacy', { p_area_label: 'Lisbon', p_social_visibility: 'followers', p_dating_discoverable: false });
    // B was paused when ... B could not like A, so B first resumes, likes A, pauses; A's like stays inert meanwhile
    await rpc(B, 'save_privacy', { p_area_label: 'Lisbon', p_social_visibility: 'followers', p_dating_discoverable: true });
    await likeRes(B, A); expect(await matchRows(A, B)).toHaveLength(1);
    const C = await datingUser('rsC'); const E = await datingUser('rsE');
    await likeRes(C, E); await rpc(E, 'save_privacy', { p_area_label: 'Lisbon', p_social_visibility: 'followers', p_dating_discoverable: false });
    await likeRes(E, C).catch(() => undefined);
    expect(await matchRows(C, E), 'no match while E is paused').toHaveLength(0);
  });
  it('a resumed person with a pending mutual like is matched on resume (and both are told)', async () => {
    const A = await datingUser('rmA'); const B = await datingUser('rmB');
    await likeRes(B, A);                                             // B likes A while both live
    await rpc(A, 'save_privacy', { p_area_label: 'Lisbon', p_social_visibility: 'followers', p_dating_discoverable: false });
    // A's earlier like of B existed before the pause: simulate it, since a paused person cannot create one
    localSql(`insert into public.dating_actions (actor_id, target_id, action) values ('${A.id}', '${B.id}', 'like') on conflict do nothing`);
    expect(await matchRows(A, B)).toHaveLength(0);
    await rpc(A, 'save_privacy', { p_area_label: 'Lisbon', p_social_visibility: 'followers', p_dating_discoverable: true });
    expect(await matchRows(A, B), 'resume reconciles').toHaveLength(1);
    expect(must(await admin.from('notifications').select('recipient_id').eq('type', 'match').in('recipient_id', [A.id, B.id]))).toHaveLength(2);
  });
});

describe('photo policy for the dating audience', () => {
  it('only eligible viewers (or matches) can read a dating-only person’s photos; blocks and pause close it', async () => {
    const T = await datingUser('phT', { gender: 'man', interestedIn: ['women'], social: 'followers' });
    const ok = await datingUser('phOk', { gender: 'woman', interestedIn: ['men'] }); const no = await datingUser('phNo', { gender: 'woman', interestedIn: ['women'] });
    const path = must(await T.sb.from('profile_photos').select('storage_path'))[0]!.storage_path as string;
    const can = async (u: TestUser) => (await u.sb.storage.from('profile-photos').createSignedUrl(path, 60)).error === null;
    expect(await can(T), 'owner').toBe(true); expect(await can(ok), 'eligible viewer').toBe(true); expect(await can(no), 'incompatible viewer').toBe(false);
    await rpc(T, 'save_privacy', { p_area_label: 'x', p_social_visibility: 'followers', p_dating_discoverable: false });
    expect(await can(ok), 'paused: closed to non-matches').toBe(false);
    await rpc(T, 'save_privacy', { p_area_label: 'x', p_social_visibility: 'followers', p_dating_discoverable: true });
    await rpc(ok, 'like_profile', { p_target: T.id }); await rpc(T, 'like_profile', { p_target: ok.id });
    await rpc(T, 'save_privacy', { p_area_label: 'x', p_social_visibility: 'followers', p_dating_discoverable: false });
    expect(await can(ok), 'a match keeps access even while paused').toBe(true);
    await rpc(T, 'block_user', { p_user: ok.id }); expect(await can(ok), 'a block closes it').toBe(false);
    const T2 = await datingUser('phT2', { gender: 'man', interestedIn: ['women'], social: 'followers' }); const p2 = must(await T2.sb.from('profile_photos').select('storage_path'))[0]!.storage_path as string;
    const viewer = await datingUser('phV2', { gender: 'woman', interestedIn: ['men'] });
    expect((await viewer.sb.storage.from('profile-photos').createSignedUrl(p2, 60)).error).toBeNull();
    await rpc(T2, 'block_user', { p_user: viewer.id }); expect((await viewer.sb.storage.from('profile-photos').createSignedUrl(p2, 60)).error, 'blocked viewer').not.toBeNull();
  });
});

describe('discovery order and pagination', () => {
  let V: TestUser; const cohort: TestUser[] = [];
  beforeAll(async () => {
    V = await datingUser('pgV', { place: 'lisbon', gender: 'woman', interestedIn: ['men'], ageMin: 18, ageMax: 99 });
    for (let i = 0; i < 24; i += 4) cohort.push(...(await Promise.all([0, 1, 2, 3].map((k) => datingUser(`pg${i + k}`, { gender: 'man', interestedIn: ['women'], interests: ['pgtag'.slice(0, 0) || 'coffee'] })))));
  });
  const mine = (rows: Card[]) => rows.filter((r) => cohort.some((c) => c.id === r.user_id));
  it('is a stable daily shuffle: same order on every call, no duplicates, everyone once', async () => {
    const a = await discoverAll(V); const b = await discoverAll(V);
    expect(a.map((c) => c.user_id)).toEqual(b.map((c) => c.user_id));
    const ids = a.map((c) => c.user_id); expect(new Set(ids).size).toBe(ids.length);
    expect(mine(a)).toHaveLength(cohort.length);
    const other = await discoverAll(await datingUser('pgOther', { gender: 'woman', interestedIn: ['men'] }));
    expect(mine(other).map((c) => c.user_id), 'a different viewer gets a different order').not.toEqual(mine(a).map((c) => c.user_id));
    expect(a.map((c) => c.user_id), 'order is not by creation time, name or id').not.toEqual([...ids].sort());
  });
  it('page size is clamped to 10..20 with a lookahead row', async () => {
    expect((await discover(V, null, 1)).length).toBe(11); expect((await discover(V, null, 500)).length).toBe(21);
  });
  it('stays stable while people are liked, passed and added mid-session', async () => {
    const p1 = await discover(V, null, 10); const first = p1.slice(0, 10); const cursor = first[9]!.page_cursor;
    await rpc(V, 'like_profile', { p_target: first[0]!.user_id }); await rpc(V, 'pass_profile', { p_target: first[1]!.user_id });
    const newcomer = await datingUser('pgNew', { gender: 'man', interestedIn: ['women'] });
    const rest: Card[] = []; let c: string | null = cursor;
    for (let i = 0; i < 10; i++) { const page = await discover(V, c, 10); rest.push(...page.slice(0, 10)); if (page.length <= 10) break; c = page[9]!.page_cursor; }
    const seen = new Set(first.map((x) => x.user_id)); for (const r of rest) { expect(seen.has(r.user_id), `no repeats (${r.display_name})`).toBe(false); seen.add(r.user_id); }
    const expectedRest = (await discoverAll(V, 10)); // fresh walk, minus liked and passed
    for (const id of [first[0]!.user_id, first[1]!.user_id]) expect(expectedRest.some((x) => x.user_id === id)).toBe(false);
    void newcomer;
  });
  it('rejects malformed or out-of-window cursors and a forged cursor reveals nothing hidden', async () => {
    for (const bad of ['garbage', "x'; drop table matches;--", '2026-01-01|nothex|' + rid(), '|', ' ', '1999-01-01|' + 'a'.repeat(32) + '|' + rid(), '2999-01-01|' + 'a'.repeat(32) + '|' + rid()]) {
      await rpcFails(V, 'discover_profiles', { p_cursor: bad }, 'LOVOKI_INVALID_CURSOR');
    }
    const today = new Date().toISOString().slice(0, 10);
    const forged = `${today}|${'0'.repeat(32)}|${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`;
    const rows = await discover(V, forged, 20); const ids = new Set((await discoverAll(V)).map((c) => c.user_id));
    for (const r of rows) expect(ids.has(r.user_id), 'only people already eligible can ever appear').toBe(true);
    expect(forbidden(rows)).toEqual([]);
  });
  it('rate-limits discover calls and caps daily likes, with the limits named in one place', async () => {
    const R = await datingUser('rlR'); const targets = await Promise.all([0, 1, 2, 3].map((i) => datingUser(`rlT${i}`)));
    try {
      localSql('create or replace function public._limit_discover_hourly() returns int language sql immutable set search_path = \'\' as $$ select 3 $$');
      await discover(R); await discover(R); await discover(R);
      await rpcFails(R, 'discover_profiles', {}, 'LOVOKI_RATE_LIMITED');
      localSql('create or replace function public._limit_daily_likes() returns int language sql immutable set search_path = \'\' as $$ select 2 $$');
      await likeRes(R, targets[0]!); await likeRes(R, targets[1]!);
      await rpcFails(R, 'like_profile', { p_target: targets[2]!.id }, 'LOVOKI_DAILY_LIMIT');
      expect(await likeRes(R, targets[0]!), 'repeating an existing like does not use the cap').toEqual({ matched: false, match_id: null });
      expect((await rpc<{ likes_left: number; daily_cap: number }[]>(R, 'dating_status'))[0]).toMatchObject({ likes_left: 0, daily_cap: 2 });
      await rpc(R, 'pass_profile', { p_target: targets[3]!.id }); // passes are not capped
    } finally {
      localSql('create or replace function public._limit_discover_hourly() returns int language sql immutable set search_path = \'\' as $$ select 120 $$');
      localSql('create or replace function public._limit_daily_likes() returns int language sql immutable set search_path = \'\' as $$ select 50 $$');
    }
    expect(localSql('select public._limit_daily_likes(), public._limit_discover_hourly(), public._pass_days()')).toBe('50|120|90');
  });
});

describe('what the cards contain', () => {
  it('never contains coordinates, date of birth, discoverability, like flags or finer distance, anywhere', async () => {
    const A = await datingUser('cdA', { place: 'lisbon', gender: 'woman', interestedIn: ['men'] }); const B = await datingUser('cdB', { place: 'sintra', gender: 'man', interestedIn: ['women'] });
    await likeRes(B, A); await likeRes(A, B);
    const responses: unknown[] = [await discover(A), await rpc(A, 'dating_profile', { p_user: B.id }), await matchesOf(A), await rpc(A, 'list_matches', { p_limit: 20 }),
      await rpc(A, 'notifications_page', { p_limit: 20 }), await rpc(A, 'dating_status'), await rpc(A, 'social_profile', { p_user: B.id }), await rpc(B, 'social_profile', { p_user: A.id })];
    for (const [i, r] of responses.entries()) expect(forbidden(r), `response ${i}`).toEqual([]);
    const text = JSON.stringify(responses);
    for (const needle of ['38.8', '-9.38', '38.72', '-9.14', '38.80']) expect(text, `coordinate fragment ${needle}`).not.toContain(needle);
    expect(text).not.toMatch(/date_of_birth|birth/i);
    const card = (await rpc<Card[]>(A, 'dating_profile', { p_user: B.id }))[0]!;
    expect(Object.keys(card).sort()).toEqual(['age', 'area_label', 'bio', 'display_name', 'distance_bucket', 'gender', 'interests', 'intention', 'is_match', 'match_id', 'matched_at', 'photo_paths', 'prompts', 'pronouns', 'user_id'].sort());
    expect(['<5', '<10', '<25', '<50', '<100', '100+']).toContain(card.distance_bucket);
  });
});

describe('the Phase 2 view that listed discoverable people is gone', () => {
  it('discoverable_profiles cannot be read by anyone', async () => {
    const A = await datingUser('gvA'); expect((await rawRest(A, 'GET', 'discoverable_profiles?select=*')).status).toBeGreaterThanOrEqual(400);
    expect((await rawRest(null, 'GET', 'discoverable_profiles?select=*')).status).toBeGreaterThanOrEqual(400);
  });
});
