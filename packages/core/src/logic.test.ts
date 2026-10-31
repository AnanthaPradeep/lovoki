import { describe, it, expect } from 'vitest';
import { seedState } from './seed';
import { reduce, discoverQueue, canMessage, feed, conversationList, validateProfile, undecidedCount, canSeePost } from './logic';
import { LovokiStore, memoryStorage } from './store';
import { DEFAULT_FILTERS } from './types';
import { colors, contrastRatio } from '@lovoki/tokens';

const now = 1_700_000_000_000;

describe('matching', () => {
  it('liking a demo profile that likes you back creates a match and unlocks messages', () => {
    let s = seedState(now);
    expect(canMessage(s, 'maya')).toBe(false);
    s = reduce(s, { type: 'like', profileId: 'maya', now });
    expect(s.matches[0]).toMatchObject({ profileId: 'maya', demo: true });
    expect(canMessage(s, 'maya')).toBe(true);
    expect(discoverQueue(s).some((p) => p.id === 'maya')).toBe(false);
  });
  it('liking someone who has not liked you does not match', () => {
    const s = reduce(seedState(now), { type: 'like', profileId: 'arjun', now });
    expect(s.matches.some((m) => m.profileId === 'arjun')).toBe(false);
    expect(canMessage(s, 'arjun')).toBe(false);
  });
  it('liking twice does not duplicate the match', () => {
    let s = reduce(seedState(now), { type: 'like', profileId: 'kofi', now });
    s = reduce(s, { type: 'like', profileId: 'kofi', now });
    expect(s.matches.filter((m) => m.profileId === 'kofi')).toHaveLength(1);
  });
  it('following alone never unlocks dating messages', () => {
    const s = reduce(seedState(now), { type: 'follow', profileId: 'arjun' });
    expect(s.following).toContain('arjun');
    expect(canMessage(s, 'arjun')).toBe(false);
    expect(s.matches.some((m) => m.profileId === 'arjun')).toBe(false);
  });
  it('pass removes from queue; unmatch removes conversation', () => {
    let s = reduce(seedState(now), { type: 'pass', profileId: 'lena' });
    expect(discoverQueue(s).some((p) => p.id === 'lena')).toBe(false);
    s = reduce(s, { type: 'unmatch', profileId: 'theo' });
    expect(s.conversations.theo).toBeUndefined();
    expect(conversationList(s).some((c) => c.profile.id === 'theo')).toBe(false);
  });
});

describe('filters', () => {
  it('age, distance, intention and interest filters change results', () => {
    const s = seedState(now);
    const all = discoverQueue(s).length;
    const young = discoverQueue({ ...s, filters: { ...DEFAULT_FILTERS, ageMax: 27 } });
    expect(young.every((p) => p.age <= 27)).toBe(true);
    expect(young.length).toBeLessThan(all);
    const near = discoverQueue({ ...s, filters: { ...DEFAULT_FILTERS, maxDistanceKm: 5 } });
    expect(near.every((p) => p.distanceKm <= 5)).toBe(true);
    const lt = discoverQueue({ ...s, filters: { ...DEFAULT_FILTERS, intentions: ['long-term'] } });
    expect(lt.every((p) => p.intention === 'long-term')).toBe(true);
    const ceramics = discoverQueue({ ...s, filters: { ...DEFAULT_FILTERS, interests: ['Ceramics'] } });
    expect(ceramics.map((p) => p.id)).toEqual(['maya']);
  });
  it('distinguishes empty-by-filter from seen-everyone', () => {
    const s = { ...seedState(now), filters: { ...DEFAULT_FILTERS, ageMin: 90, ageMax: 99 } };
    expect(discoverQueue(s)).toHaveLength(0);
    expect(undecidedCount(s)).toBeGreaterThan(0);
  });
});

describe('blocking and privacy', () => {
  it('blocking removes the account from discover, feed, connections and messages', () => {
    let s = seedState(now);
    s = reduce(s, { type: 'block', profileId: 'sofia' });
    s = reduce(s, { type: 'block', profileId: 'maya' });
    expect(discoverQueue(s).some((p) => p.id === 'maya')).toBe(false);
    expect(feed(s, 'explore').some((p) => p.authorId === 'maya')).toBe(false);
    expect(feed(s, 'following').some((p) => p.authorId === 'maya')).toBe(false);
    expect(s.following).not.toContain('maya');
    expect(conversationList(s).some((c) => c.profile.id === 'sofia')).toBe(false);
    expect(canMessage(s, 'sofia')).toBe(false);
  });
  it('followers-only posts are hidden from non-followers', () => {
    const s = seedState(now);
    const sofiaPost = s.posts.find((p) => p.authorId === 'sofia' && p.audience === 'followers')!;
    expect(canSeePost(s, sofiaPost)).toBe(false);
    expect(canSeePost(reduce(s, { type: 'follow', profileId: 'sofia' }), sofiaPost)).toBe(true);
    expect(feed(s, 'explore').every((p) => p.audience === 'public')).toBe(true);
  });
});

describe('validation', () => {
  const base = { name: 'Pradi', age: '30', area: 'Kochi', work: '', pronouns: '', bio: '', intention: 'long-term', interests: ['Music'], prompts: [] };
  it('accepts a valid draft', () => expect(validateProfile(base)).toEqual({}));
  it('rejects under-18, empty name, coordinates and no interests', () => {
    const e = validateProfile({ ...base, name: ' ', age: '17', area: '9.9312, 76.2673', interests: [] });
    expect(Object.keys(e).sort()).toEqual(['age', 'area', 'interests', 'name']);
  });
});

describe('store', () => {
  it('message send succeeds, fails with simulated failure, and retries', async () => {
    const st = new LovokiStore(memoryStorage(), 1, seedState(now));
    await st.sendMessage('theo', 'Hello');
    let msgs = st.getState().conversations.theo!.messages;
    expect(msgs.at(-1)).toMatchObject({ text: 'Hello', delivery: 'delivered' });
    st.setSimulateFailures(true);
    await st.sendMessage('theo', 'Again');
    msgs = st.getState().conversations.theo!.messages;
    expect(msgs.at(-1)!.delivery).toBe('failed');
    st.setSimulateFailures(false);
    await st.retryMessage('theo', msgs.at(-1)!.id);
    expect(st.getState().conversations.theo!.messages.at(-1)!.delivery).toBe('delivered');
  });
  it('cannot message a non-match', async () => {
    const st = new LovokiStore(memoryStorage(), 1, seedState(now));
    await st.sendMessage('arjun', 'Hi');
    expect(st.getState().conversations.arjun).toBeUndefined();
  });
  it('persists and resets', async () => {
    const storage = memoryStorage();
    const a = new LovokiStore(storage, 1, seedState(now));
    a.follow('arjun');
    const b = new LovokiStore(storage, 1); await b.hydrate();
    expect(b.getState().following).toContain('arjun');
    await b.resetDemo();
    expect(b.getState().following).not.toContain('arjun');
  });
});

describe('token contrast (WCAG AA)', () => {
  for (const t of ['light', 'dark'] as const) {
    const c = colors[t];
    const pairs: [string, string, string, number][] = [
      ['text/bg', c.text, c.bg, 4.5], ['text/surface', c.text, c.surface, 4.5], ['muted/bg', c.textMuted, c.bg, 4.5],
      ['muted/surface', c.textMuted, c.surface, 4.5], ['subtle/surface', c.textSubtle, c.surface, 4.5], ['subtle/bg', c.textSubtle, c.bg, 4.5],
      ['onPrimary/primary', c.onPrimary, c.primary, 4.5], ['onPrimarySoft/primarySoft', c.onPrimarySoft, c.primarySoft, 4.5],
      ['onMatch/match', c.onMatch, c.match, 4.5], ['error/surface', c.error, c.surface, 4.5], ['error/errorSoft', c.error, c.errorSoft, 4.5],
      ['success/successSoft', c.success, c.successSoft, 4.5], ['warning/warningSoft', c.warning, c.warningSoft, 4.5], ['info/infoSoft', c.info, c.infoSoft, 4.5],
      ['focus/bg', c.focus, c.bg, 3], ['borderStrong/surface', c.borderStrong, c.surface, 1.8],
    ];
    for (const [name, fg, bg, min] of pairs)
      it(`${t} ${name} ≥ ${min}`, () => expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min));
  }
});
