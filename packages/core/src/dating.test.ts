// UNIT and MOCKED tests for Phase 4 logic. They prove helpers, reducers and the fake's contract, not the database.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FakeDatingApi, FakeDatingWorld, FakeSocialWorld, DatingFailure, FAKE_PLACES, fakePlaceById, bucketLabel, bucketOf, compatible, deckReducer, effectiveMaxKm, emptyDeck, emptyReason,
  haversineKm, isDiscoverCursor, matchedAgo, roundCoord, safeDiscoverCursor, wantsGender, type DatingCard, type DeckState, type Prefs,
} from './index';

const card = (n: number): DatingCard => ({ id: `c${n}`, userId: `c${n}`, displayName: `C${n}`, username: null, genderCustom: null, avatarPath: null, avatarCrop: null, details: {}, age: 30, gender: null, areaLabel: '', distanceBucket: null, intention: 'long-term', interests: [], prompts: [], photoPaths: [], bio: '', pronouns: null, cursor: `d|${n}` });
const deck = (n: number): DeckState => deckReducer(emptyDeck(), { type: 'replace', page: { items: Array.from({ length: n }, (_, i) => card(i)), next: null } });

describe('distance helpers', () => {
  it('turns kilometres into buckets only', () => {
    expect([bucketOf(0), bucketOf(4.99), bucketOf(5), bucketOf(24.9), bucketOf(25), bucketOf(99.9), bucketOf(100), bucketOf(5000)]).toEqual(['<5', '<5', '<10', '<25', '<50', '<100', '100+', '100+']);
    expect(bucketLabel('<25')).toBe('Less than 25 km away'); expect(bucketLabel('100+')).toBe('More than 100 km away'); expect(bucketLabel(null)).toBeNull();
  });
  it('rounds a max distance up to a bucket edge, and no limit above 100', () => {
    expect([1, 5, 6, 10, 11, 25, 26, 50, 51, 100, 101, 500].map(effectiveMaxKm)).toEqual([5, 5, 10, 10, 25, 25, 50, 50, 100, 100, null, null]); expect(effectiveMaxKm(null)).toBeNull();
  });
  it('haversine matches known distances; place rounding is about 1 km', () => {
    const lisbon = { lat: 38.72, lng: -9.14 };
    expect(haversineKm(lisbon, { lat: 38.68, lng: -9.16 })).toBeLessThan(5); expect(haversineKm(lisbon, { lat: 41.15, lng: -8.61 })).toBeGreaterThan(260);
    expect(haversineKm(lisbon, lisbon)).toBe(0); expect(roundCoord(38.723456)).toBe(38.72); expect(roundCoord(-9.139876)).toBe(-9.14);
    expect(FAKE_PLACES.every((p) => p.lat === roundCoord(p.lat) && p.lng === roundCoord(p.lng))).toBe(true);
  });
});

describe('compatibility hint', () => {
  const a: Prefs = { gender: 'woman', interestedIn: ['men'], age: 30, ageMin: 25, ageMax: 40 };
  const b: Prefs = { gender: 'man', interestedIn: ['women', 'non-binary'], age: 33, ageMin: 28, ageMax: 35 };
  it('needs gender and age to fit both ways', () => {
    expect(compatible(a, b)).toBe(true);
    expect(compatible(a, { ...b, interestedIn: ['men'] })).toBe(false); expect(compatible({ ...a, interestedIn: ['women'] }, b)).toBe(false);
    expect(compatible(a, { ...b, age: 45 })).toBe(false); expect(compatible(a, { ...b, ageMin: 31 })).toBe(false);
    expect(compatible(a, { ...b, gender: null })).toBe(false); expect(compatible({ ...a, age: 17 }, b)).toBe(false);
    expect(wantsGender('non-binary', ['non-binary'])).toBe(true); expect(wantsGender('woman', ['men'])).toBe(false);
  });
});

describe('cursors', () => {
  const ok = '2026-06-01|' + 'a'.repeat(32) + '|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  it('accepts only the exact discover cursor shape and drops everything else', () => {
    expect(isDiscoverCursor(ok)).toBe(true); expect(safeDiscoverCursor(ok)).toBe(ok);
    for (const bad of ['', 'x', "1'; drop", '2026-06-01|short|id', null, undefined, 7]) { expect(isDiscoverCursor(bad as never), String(bad)).toBe(false); expect(safeDiscoverCursor(bad as never)).toBeNull(); }
  });
});

describe('deck reducer (optimistic like and pass)', () => {
  it('removes the card at once and puts it back where it was on failure', () => {
    let s = deck(4); s = deckReducer(s, { type: 'act/start', id: 'c1', action: 'like' });
    expect(s.items.map((c) => c.id)).toEqual(['c0', 'c2', 'c3']); expect(s.pending).toHaveLength(1);
    s = deckReducer(s, { type: 'act/fail', id: 'c1' }); expect(s.items.map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3']); expect(s.pending).toHaveLength(0);
  });
  it('ignores a second tap on a card that is already in flight, and unknown cards', () => {
    let s = deck(2); s = deckReducer(s, { type: 'act/start', id: 'c0', action: 'like' }); const once = s;
    expect(deckReducer(s, { type: 'act/start', id: 'c0', action: 'pass' })).toBe(once); expect(deckReducer(s, { type: 'act/start', id: 'nope', action: 'like' })).toBe(once);
  });
  it('a matched like raises the match once; a plain like or pass does not', () => {
    let s = deck(3); s = deckReducer(s, { type: 'act/start', id: 'c0', action: 'like' }); s = deckReducer(s, { type: 'act/ok', id: 'c0', result: { matched: false, matchId: null } }); expect(s.matched).toBeNull();
    s = deckReducer(s, { type: 'act/start', id: 'c1', action: 'like' }); s = deckReducer(s, { type: 'act/ok', id: 'c1', result: { matched: true, matchId: 'm1' } });
    expect(s.matched).toMatchObject({ matchId: 'm1', card: { id: 'c1' } }); s = deckReducer(s, { type: 'dismissMatch' }); expect(s.matched).toBeNull();
    s = deckReducer(s, { type: 'act/start', id: 'c2', action: 'pass' }); s = deckReducer(s, { type: 'act/ok', id: 'c2', result: { matched: true, matchId: 'm2' } }); expect(s.matched, 'a pass can never match').toBeNull();
  });
  it('appending a page never duplicates a card that is on screen or in flight', () => {
    let s = deck(2); s = deckReducer(s, { type: 'act/start', id: 'c0', action: 'like' });
    s = deckReducer(s, { type: 'append', page: { items: [card(0), card(1), card(2)], next: 'x' } });
    expect(s.items.map((c) => c.id)).toEqual(['c1', 'c2']); expect(s.next).toBe('x');
  });
});

describe('empty states say why, honestly', () => {
  const st = { paused: false, hasGender: true, hasPlace: true, likesLeft: 10, dailyCap: 50 };
  it('picks the most actionable reason first', () => {
    expect(emptyReason({ ...st, paused: true }, false).reason).toBe('paused'); expect(emptyReason({ ...st, hasGender: false }, false).reason).toBe('needs-gender');
    expect(emptyReason({ ...st, likesLeft: 0 }, false)).toMatchObject({ reason: 'daily-limit', title: 'That’s today’s limit' });
    const none = emptyReason(st, true); expect(none.reason).toBe('no-one-new'); expect(none.body).toMatch(/widen|Widen/i);
    expect(emptyReason(st, false).body).toMatch(/don’t invent people/);
    expect(JSON.stringify([emptyReason(st, false), emptyReason({ ...st, likesLeft: 0 }, false)])).not.toMatch(/hurry|last chance|only \d+ left|running out/i);
  });
  it('matchedAgo is short and never negative', () => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    expect([matchedAgo('2026-06-10T11:59:50Z', now), matchedAgo('2026-06-10T11:30:00Z', now), matchedAgo('2026-06-10T09:00:00Z', now), matchedAgo('2026-06-09T12:00:00Z', now), matchedAgo('2026-06-12T12:00:00Z', now)])
      .toEqual(['just now', '30 min ago', '3 h ago', '1 day ago', 'just now']);
  });
});

describe('FakeDatingApi follows the documented rules (MOCKED)', () => {
  let w: FakeDatingWorld; let S: FakeSocialWorld;
  let ann: string, ben: string, cy: string, dee: string; let A: FakeDatingApi, B: FakeDatingApi, C: FakeDatingApi;
  const lisbon = fakePlaceById(2267057)!; const sintra = { ...lisbon, id: 1, name: 'Sintra', label: 'Sintra', lat: 38.8, lng: -9.38 };
  beforeEach(() => {
    S = new FakeSocialWorld(); w = new FakeDatingWorld(S);
    ann = S.addUser({ name: 'Ann', age: 30 }).id; ben = S.addUser({ name: 'Ben', age: 32 }).id; cy = S.addUser({ name: 'Cy', age: 29 }).id; dee = S.addUser({ name: 'Dee', age: 31 }).id;
    w.setDating(ann, { gender: 'woman', interestedIn: ['men'], place: lisbon }); w.setDating(ben, { gender: 'man', interestedIn: ['women'], place: sintra });
    w.setDating(cy, { gender: 'woman', interestedIn: ['women'] }); w.setDating(dee, { gender: 'man', interestedIn: ['women'], discoverable: false });
    A = new FakeDatingApi(w, ann); B = new FakeDatingApi(w, ben); C = new FakeDatingApi(w, cy);
  });
  const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof DatingFailure ? e.code : 'other'; } };

  it('shows only compatible, non-paused people with a bucket and no coordinates', async () => {
    const page = await A.discover(); expect(page.items.map((c) => c.userId)).toEqual([ben]);
    expect(page.items[0]!.distanceBucket).toBe('<25'); expect(JSON.stringify(page.items)).not.toMatch(/lat|lng|38\.7|birth|discoverable|liked/i);
  });
  it('a mutual like matches both, announces it, and a first like is not announced', async () => {
    expect(await A.like(ben)).toEqual({ matched: false, matchId: null }); expect(S.notes.filter((n) => n.recipient === ben)).toHaveLength(0);
    const r = await B.like(ann); expect(r.matched).toBe(true);
    expect(S.notes.filter((n) => n.type === 'match').map((n) => n.recipient).sort()).toEqual([ann, ben].sort());
    expect((await A.matches()).items.map((m) => m.userId)).toEqual([ben]); expect((await A.discover()).items).toHaveLength(0);
  });
  it('liking someone ineligible looks exactly like liking someone eligible', async () => {
    const results = [await A.like(ben), await A.like(cy), await A.like(dee), await A.like(crypto.randomUUID())];
    for (const r of results) expect(r).toEqual({ matched: false, matchId: null });
  });
  it('pass hides for 90 days and notifies nobody; unmatch and block exclude for good', async () => {
    await A.pass(ben); expect((await A.discover()).items).toHaveLength(0); expect(S.notes).toHaveLength(0);
    w.actions.get(`${ann}>${ben}`)!.at -= 91 * 86_400_000; expect((await A.discover()).items).toHaveLength(1);
    await A.like(ben); await B.like(ann); const m = (await A.matches()).items[0]!;
    await B.unmatch(m.matchId); expect((await A.matches()).items).toHaveLength(0); expect(await A.discover().then((p) => p.items.length)).toBe(0);
    expect(await code(A.unmatch(m.matchId))).toBe('not_found');
  });
  it('pause hides you, blocks liking, and resuming makes stored mutual likes live', async () => {
    w.setDating(cy, { gender: 'woman', interestedIn: ['men'] }); const W = w.d(cy);
    w.setDating(dee, { gender: 'man', interestedIn: ['women'], discoverable: false });
    const D = new FakeDatingApi(w, dee); expect(await code(D.like(cy))).toBe('paused'); expect(await code(D.discover())).toBe('paused');
    expect(await new FakeDatingApi(w, cy).like(dee)).toEqual({ matched: false, matchId: null }); void W;
    w.actions.set(`${dee}>${cy}`, { action: 'like', at: Date.now() }); w.setDiscoverable(dee, true);
    expect((await D.matches()).items.map((m) => m.userId)).toEqual([cy]);
  });
  it('enforces the daily cap with a calm error, and a status that says how many are left', async () => {
    w.dailyCap = 1; const extra = S.addUser({ name: 'Ed', age: 33 }).id; w.setDating(extra, { gender: 'man', interestedIn: ['women'] });
    await A.like(ben); expect(await code(A.like(extra))).toBe('daily_limit'); expect(await A.status()).toMatchObject({ likesLeft: 0, dailyCap: 1 }); expect(await A.like(ben)).toBeTruthy();
  });
  it('rejects forged cursors and keeps the same order within a day', async () => {
    expect(await code(A.discover("x'; drop"))).toBe('invalid_cursor');
    for (let i = 0; i < 25; i++) { const id = S.addUser({ name: `M${i}`, age: 30 }).id; w.setDating(id, { gender: 'man', interestedIn: ['women'] }); }
    const p1 = await A.discover(); expect(p1.items).toHaveLength(10); const p2 = await A.discover(p1.next);
    const again = await A.discover(); expect(again.items.map((c) => c.id)).toEqual(p1.items.map((c) => c.id));
    expect(new Set([...p1.items, ...p2.items].map((c) => c.id)).size).toBe(p1.items.length + p2.items.length);
  });
  it('a block ends a match and hides the pair', async () => {
    await A.like(ben); await B.like(ann); S.blocks.add(`${ann}>${ben}`); S.onBlock?.(ann, ben);
    expect((await A.matches()).items).toHaveLength(0); expect(await B.profile(ann)).toBeNull();
  });
  it('M-visibility: pronouns only for matches', async () => {
    w.setDating(ben, { pronouns: 'he/him' }); expect((await A.profile(ben))!.pronouns).toBeNull();
    await A.like(ben); await B.like(ann); expect((await A.profile(ben))!.pronouns).toBe('he/him'); void C;
  });
});
