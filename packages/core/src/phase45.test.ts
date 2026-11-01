// MOCKED / pure tests for Phase 4.5. They prove the helpers and that the fake follows the documented matrix.
// They are NOT evidence about the database: tests/integration/privacy45.int.test.ts is.
import { describe, expect, it } from 'vitest';
import {
  FAKE_BLURHASH, FakeSocialApi, FakeSocialWorld, SOCIAL_RULES, SIGNED_URL_CACHE_MS, SIGNED_URL_TTL_S, followAction, formatCount, isBlurhash, privacyOverview, privateLockCopy,
  type SocialProfileView,
} from './index';

describe('formatCount', () => {
  it.each([[0, '0'], [7, '7'], [999, '999'], [1000, '1K'], [1234, '1.2K'], [1999, '1.9K'], [12_345, '12.3K'], [99_999, '99.9K'], [100_000, '100K'], [999_999, '999K'],
    [1_000_000, '1M'], [3_456_789, '3.4M'], [1_000_000_000, '1B']])('%i -> %s', (n, out) => expect(formatCount(n)).toBe(out));
  it('never rounds up into the next unit and shows a dash for missing counts', () => {
    expect(formatCount(999_999)).not.toMatch(/1000K|1M/);
    for (const bad of [null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatCount(bad as number)).toBe('–');
  });
});

describe('blurhash helper', () => {
  it('accepts real blurhashes and rejects anything that is not one', () => {
    expect(isBlurhash(FAKE_BLURHASH)).toBe(true); expect(isBlurhash('LEHV6nWB2yk8pyo0adR*.7kCMdnj')).toBe(true);
    for (const bad of ['', 'abc', 'has space in it!', 'x'.repeat(121), '<script>alert(1)</script>', null, 42]) expect(isBlurhash(bad)).toBe(false);
  });
});

describe('signed URL policy constants', () => {
  it('uses a 120 second lifetime and never caches past it', () => {
    expect(SIGNED_URL_TTL_S).toBe(120); expect(SIGNED_URL_CACHE_MS).toBeLessThan(SIGNED_URL_TTL_S * 1000); expect(SOCIAL_RULES.thumbMaxPx).toBe(400);
  });
});

describe('privacyOverview', () => {
  const base = { isPrivate: false, showAvatarToEveryone: false, showFollowerCounts: true, searchable: true, datingDiscoverable: false };
  const text = (o: ReturnType<typeof privacyOverview>) => JSON.stringify(o);
  it('states both layers and says that a private social account does not hide Discover', () => {
    const o = privacyOverview({ ...base, isPrivate: true, datingDiscoverable: true });
    expect(o.social.length).toBeGreaterThanOrEqual(5); expect(o.dating.length).toBeGreaterThanOrEqual(3);
    expect(text(o)).toMatch(/Does not hide you in Discover/); expect(text(o)).toMatch(/Only people you accept as followers/);
    expect(o.social.find((r) => r.label === 'Your profile picture')!.value).toMatch(/Blurred/);
  });
  it('changes the sentences when the switches change', () => {
    expect(privacyOverview({ ...base, isPrivate: true, showAvatarToEveryone: true }).social.find((r) => r.label === 'Your profile picture')!.value).toBe('Everyone on LOVOKI');
    expect(privacyOverview({ ...base, showFollowerCounts: false }).social.find((r) => r.label.startsWith('Your followers'))!.value).toBe('Only you');
    expect(privacyOverview({ ...base, searchable: false }).social.find((r) => r.label.startsWith('Search'))!.value).toMatch(/Hidden/);
    expect(privacyOverview(base).dating[0]!.value).toMatch(/Nobody/); expect(privacyOverview({ ...base, datingDiscoverable: true }).dating[0]!.value).toMatch(/Discover/);
  });
  it('never promises more than the database gives (no claim of hiding names, handles or bios on a private account)', () => {
    expect(text(privacyOverview({ ...base, isPrivate: true }))).toMatch(/Anyone on LOVOKI, even if your account is private/);
  });
});

describe('follow action and lock copy', () => {
  const p = (o: Partial<SocialProfileView> & { isPrivate?: boolean }) => ({ isSelf: false, followStatus: null, restricted: false, ...o });
  it('a private account always means "request", whatever else is known', () => {
    expect(followAction(p({ isPrivate: true }))).toBe('request'); expect(followAction(p({}))).toBe('follow');
    expect(followAction(p({ isPrivate: true, followStatus: 'pending' }))).toBe('cancel'); expect(followAction(p({ isPrivate: true, followStatus: 'accepted' }))).toBe('unfollow');
    expect(followAction(p({ isSelf: true }))).toBe('none');
  });
  it('the lock panel says what to do, and changes after a request', () => {
    expect(privateLockCopy({ followStatus: null, displayName: 'Ben' })).toEqual({ title: 'This account is private', body: 'Follow to see their photos and videos.' });
    expect(privateLockCopy({ followStatus: 'pending', displayName: 'Ben' }).title).toBe('Request sent');
  });
});

describe('FakeSocialApi follows the same visibility matrix (mocked)', () => {
  const setup = () => {
    const w = new FakeSocialWorld();
    const priv = w.addUser({ name: 'Priv Ate', visibility: 'followers', bio: 'My bio', username: 'priv.ate' });
    const pub = w.addUser({ name: 'Pub Lic', username: 'pub.lic' });
    const follower = w.addUser({ name: 'Foll Ower' }); const stranger = w.addUser({ name: 'Stra Nger' }); const pending = w.addUser({ name: 'Pend Ing' });
    w.addPost(priv.id, 'secret one', 'public', true); w.addPost(priv.id, 'secret two', 'followers', true); w.addPost(pub.id, 'open', 'public', true); w.addPost(pub.id, 'followers only', 'followers');
    w.follows.set(`${follower.id}>${priv.id}`, 'accepted'); w.follows.set(`${pending.id}>${priv.id}`, 'pending');
    return { w, priv, pub, follower, stranger, pending, as: (id: string) => new FakeSocialApi(w, id) };
  };
  it('a stranger of a private account sees handle, name, bio, counts, a blurred avatar placeholder: no posts, no lists', async () => {
    const { priv, stranger, as } = setup(); const a = as(stranger.id);
    const prof = (await a.profileByHandle('priv.ate'))!;
    expect(prof).toMatchObject({ username: 'priv.ate', displayName: 'Priv Ate', bio: 'My bio', restricted: true, isPrivate: true, relationship: 'stranger', photoPath: null, avatarBlurhash: FAKE_BLURHASH, postCount: 2, followerCount: 1 });
    expect((await a.profilePosts('priv.ate')).items).toEqual([]); expect((await a.followersOf('priv.ate')).items).toEqual([]);
    expect((await a.feed('explore')).items.filter((p) => p.authorId === priv.id)).toEqual([]);
    expect(await a.post((await as(priv.id).profilePosts('priv.ate')).items[0]!.id)).toBeNull();
  });
  it('a follower sees everything; a pending requester is still a stranger for content', async () => {
    const { follower, pending, priv, as } = setup();
    expect((await as(follower.id).profileByHandle('priv.ate'))).toMatchObject({ relationship: 'follower', restricted: false, photoPath: `${priv.id}/avatar.jpg` });
    const grid = await as(follower.id).profilePosts('priv.ate'); expect(grid.items).toHaveLength(2); expect(grid.items[0]!.media).toMatchObject({ kind: 'image', thumbPath: expect.stringContaining('thumb') });
    expect((await as(pending.id).profileByHandle('priv.ate'))).toMatchObject({ relationship: 'pending', restricted: true, photoPath: null });
    expect((await as(pending.id).profilePosts('priv.ate')).items).toEqual([]);
  });
  it('a stranger of a PUBLIC account sees public-audience posts only', async () => {
    const { stranger, as } = setup(); const g = await as(stranger.id).profilePosts('pub.lic');
    expect(g.items.map((p) => p.caption)).toEqual(['open']);
  });
  it('the avatar toggle shows the real picture to everyone; hiding counts hides lists and counts', async () => {
    const { priv, stranger, follower, as } = setup(); priv.showAvatarToEveryone = true;
    expect((await as(stranger.id).profileByHandle('priv.ate'))!.photoPath).toBe(`${priv.id}/avatar.jpg`);
    priv.showFollowerCounts = false;
    expect(await as(follower.id).profileByHandle('priv.ate')).toMatchObject({ followerCount: null, postCount: null });
    expect((await as(follower.id).followersOf('priv.ate')).items).toEqual([]);
  });
  it('blocked in either direction: nothing, and search skips them', async () => {
    const { w, stranger, priv, as } = setup(); w.blocks.add(`${priv.id}>${stranger.id}`);
    expect(await as(stranger.id).profileByHandle('priv.ate')).toBeNull(); expect(await as(stranger.id).search('priv')).toEqual([]);
  });
  it('search: 2+ characters, prefix on handle or any name word, opt-out honoured, private shown as a limited card', async () => {
    const { w, priv, stranger, as } = setup(); const a = as(stranger.id);
    expect(await a.search('p')).toEqual([]);
    const r = await a.search('priv'); expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ username: 'priv.ate', isPrivate: true, photoPath: null, avatarBlurhash: FAKE_BLURHASH });
    expect((await a.search('ate')).map((c) => c.username)).toContain('priv.ate'); // second word of the display name
    priv.searchable = false; expect(await a.search('priv')).toEqual([]); void w;
  });
  it('samples: flagged, never notified, and reports are refused with a clear code', async () => {
    const { w, stranger, as } = setup(); const s = w.addUser({ name: 'Sam Ple', isSample: true, username: 'sam.ple' }); const pid = w.addPost(s.id, 'sample post'); const a = as(stranger.id);
    expect((await a.profileByHandle('sam.ple'))!.isSample).toBe(true); expect((await a.profilePosts('sam.ple')).items[0]!.isSample).toBe(true);
    await a.like(pid); expect(w.notes.filter((n) => n.recipient === s.id)).toEqual([]);
    await expect(a.report('post', pid, 'spam', '')).rejects.toMatchObject({ code: 'sample' }); await expect(a.report('profile', s.id, 'spam', '')).rejects.toMatchObject({ code: 'sample' });
    expect(await a.sampleFlags([s.id, stranger.id])).toEqual(new Set([s.id]));
  });
  it('a private sample stays pending (nobody accepts), a public sample accepts at once', async () => {
    const { w, stranger, as } = setup(); const ps = w.addUser({ name: 'Priv Sample', isSample: true, visibility: 'followers' }); const bs = w.addUser({ name: 'Open Sample', isSample: true });
    expect(await as(stranger.id).follow(ps.id)).toBe('pending'); expect(await as(stranger.id).follow(bs.id)).toBe('accepted');
  });
  it('suggested people: public accounts only, not already followed, same country first', async () => {
    const { w, stranger, priv, as } = setup(); w.users.get(stranger.id)!.country = 'IN'; const nearby = w.addUser({ name: 'Aaa Nearby', country: 'IN' }); w.addUser({ name: 'Zzz Faraway', country: 'DE' });
    const s = await as(stranger.id).suggested(); expect(s.map((c) => c.userId)).not.toContain(priv.id); expect(s[0]!.userId).toBe(nearby.id);
    await as(stranger.id).follow(nearby.id); expect((await as(stranger.id).suggested()).map((c) => c.userId)).not.toContain(nearby.id);
  });
});
