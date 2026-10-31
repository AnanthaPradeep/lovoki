// INTEGRATION (Phase 3.5): usernames, consent, places, optional profile fields and their visibility, avatar, social and dating settings,
// soft filters, single-post page. Real GoTrue + PostgREST + Postgres RLS on the LOCAL stack.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  TERMS_VERSION, URL_, admin, createUser, datingUser, localSql, must, placeId, post, rawRest, rid, rpc, rpcFails, setIdentity, yearsAgo, addProfilePhoto, type TestUser,
} from './harness';

const check = (u: TestUser, h: string) => rpc<string>(u, 'check_username', { p_handle: h });
const details = async (v: TestUser, o: TestUser) => ((await rpc<{ details: Record<string, unknown> }[]>(v, 'social_profile', { p_user: o.id }))[0]?.details ?? {});
const dDetails = async (v: TestUser, o: TestUser) => ((await rpc<{ details: Record<string, unknown> }[]>(v, 'dating_profile', { p_user: o.id }))[0]?.details ?? {});
const like = (u: TestUser, t: TestUser) => rpc(u, 'like_profile', { p_target: t.id });
const uname = () => `t${rid().replace(/-/g, '').slice(0, 10)}`;

describe('usernames', () => {
  let A: TestUser, B: TestUser;
  beforeAll(async () => { [A, B] = await Promise.all([createUser('unA', { complete: false }), createUser('unB', { complete: false })]); });

  it('checks the shape: 3 to 30 of a-z 0-9 . _, no leading, trailing or doubled dots', async () => {
    for (const bad of ['ab', 'x'.repeat(31), 'has space', '.lead', 'trail.', 'dou..ble', 'emo😀ji', 'dash-ed', '', '  ']) expect(await check(A, bad), JSON.stringify(bad)).toBe('invalid');
    for (const ok of ['abc', 'a.b_c', 'x'.repeat(30), 'dot.in.middle', '_under_']) expect(await check(A, uname().slice(0, 4) + ok.slice(0, 20)), ok).toBe('available');
    expect(await check(A, 'ABC' + rid().slice(0, 5).replace(/-/g, ''))).toBe('available'); // case is folded, not rejected
  });
  it('reserved words are refused in any case', async () => {
    for (const r of ['admin', 'Lovoki', 'SUPPORT', 'privacy', 'terms']) expect(await check(A, r), r).toBe('reserved');
    await rpcFails(A, 'set_username', { p_handle: 'admin' }, 'LOVOKI_USERNAME_RESERVED');
    await rpcFails(A, 'set_username', { p_handle: 'a b' }, 'LOVOKI_USERNAME_INVALID');
  });
  it('is unique and case-insensitive, and a taken name looks the same as a recently released one', async () => {
    const h = uname(); await rpc(A, 'set_username', { p_handle: h });
    expect(await check(B, h)).toBe('unavailable'); expect(await check(B, h.toUpperCase())).toBe('unavailable');
    await rpcFails(B, 'set_username', { p_handle: h.toUpperCase() }, 'LOVOKI_USERNAME_UNAVAILABLE');
    expect(await check(A, h), 'your own name is fine').toBe('available');
    expect(must(await admin.from('profiles').select('username').eq('user_id', A.id))[0]!.username).toBe(h);
  });
  it('before onboarding completes a name can be changed freely; no cooldown, no reservation', async () => {
    const C = await createUser('unC', { complete: false }); const h1 = uname(), h2 = uname();
    await rpc(C, 'set_username', { p_handle: h1 }); await rpc(C, 'set_username', { p_handle: h2 }); await rpc(C, 'set_username', { p_handle: h1 });
    expect(await check(B, h2), 'the name you left before finishing setup is free again').toBe('available');
  });
  it('after setup: one change per 30 days, and the old name is held for 30 days', async () => {
    const D = await createUser('unD'); const first = must(await admin.from('profiles').select('username').eq('user_id', D.id))[0]!.username as string;
    const second = uname(); await rpc(D, 'set_username', { p_handle: second });
    await rpcFails(D, 'set_username', { p_handle: uname() }, 'LOVOKI_USERNAME_COOLDOWN');
    expect(await check(B, first), 'the old name is held').toBe('unavailable'); await rpcFails(B, 'set_username', { p_handle: first }, 'LOVOKI_USERNAME_UNAVAILABLE');
    expect(await check(D, first), 'even you cannot take it back inside the hold').toBe('unavailable');
    localSql(`update public.profiles set username_changed_at = now() - interval '31 days' where user_id = '${D.id}'`);
    await rpc(D, 'set_username', { p_handle: uname() });
    localSql(`update public.username_history set reserved_until = now() - interval '1 day' where handle = '${first}'`);
    expect(await check(B, first), 'released after 30 days').toBe('available');
  });
  it('the availability check is rate limited', async () => {
    const R = await createUser('unR', { complete: false }); let limited = false;
    for (let i = 0; i < 64 && !limited; i++) { const r = await R.sb.rpc('check_username', { p_handle: `probe${i}abc` }); limited = !!r.error?.message.includes('LOVOKI_RATE_LIMITED'); }
    expect(limited).toBe(true);
  });
  it('resolve_username finds visible profiles only, any case; blocked, unknown and incomplete give nothing', async () => {
    const T = await datingUser('rsT', { social: 'public' }); const V = await datingUser('rsV'); const h = must(await admin.from('profiles').select('username').eq('user_id', T.id))[0]!.username as string;
    expect(await rpc(V, 'resolve_username', { p_handle: h })).toBe(T.id); expect(await rpc(V, 'resolve_username', { p_handle: h.toUpperCase() })).toBe(T.id);
    expect(await rpc(V, 'resolve_username', { p_handle: 'nobody' + rid().slice(0, 4) })).toBeNull();
    await rpc(T, 'block_user', { p_user: V.id }); expect(await rpc(V, 'resolve_username', { p_handle: h })).toBeNull();
    expect((await rawRest(null, 'POST', 'rpc/resolve_username', { p_handle: h })).status).toBeGreaterThanOrEqual(400);
  });
  it('clients cannot write usernames or history directly', async () => {
    const r = await rawRest(A, 'PATCH', `profiles?user_id=eq.${A.id}`, { username: 'hacked' + rid().slice(0, 4) }); expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await rawRest(A, 'GET', 'username_history?select=*')).status).toBeGreaterThanOrEqual(400);
  });
});

describe('consent', () => {
  it('records the terms version and the 18+ confirmation on the server clock; marketing is separate and defaults to off', async () => {
    const U = await createUser('cnA', { complete: false });
    await rpcFails(U, 'record_consent', { p_terms_version: TERMS_VERSION, p_confirm_18: false }, 'LOVOKI_INVALID');
    await rpcFails(U, 'record_consent', { p_terms_version: '', p_confirm_18: true }, 'LOVOKI_INVALID');
    await rpcFails(U, 'set_marketing_consent', { p_on: true }, 'LOVOKI_CONSENT_REQUIRED');
    const before = Date.now(); await rpc(U, 'record_consent', { p_terms_version: TERMS_VERSION, p_confirm_18: true });
    const row = must(await U.sb.from('consents').select('*'))[0] as { terms_version: string; confirmed_18: boolean; marketing: boolean; accepted_at: string };
    expect(row).toMatchObject({ terms_version: TERMS_VERSION, confirmed_18: true, marketing: false });
    expect(Math.abs(Date.parse(row.accepted_at) - before)).toBeLessThan(60_000);
    await rpc(U, 'set_marketing_consent', { p_on: true }); expect(must(await U.sb.from('consents').select('marketing'))[0]!.marketing).toBe(true);
    await rpc(U, 'record_consent', { p_terms_version: TERMS_VERSION + 'b', p_confirm_18: true }); expect(must(await U.sb.from('consents').select('marketing,terms_version'))[0], 're-accepting keeps your marketing choice').toEqual({ marketing: true, terms_version: TERMS_VERSION + 'b' });
  });
  it('the sign-up trigger records consent from the metadata the sign-up form sends', async () => {
    const email = `consent-${rid().slice(0, 8)}@lovoki-it.test`;
    const ok = must(await admin.auth.admin.createUser({ email, password: 'correct-horse-battery-1', email_confirm: true, user_metadata: { terms_version: TERMS_VERSION, confirm_18: 'true', marketing: 'false' } } as never)) as { user: { id: string } };
    expect(must(await admin.from('consents').select('*').eq('user_id', ok.user.id))[0]).toMatchObject({ terms_version: TERMS_VERSION, confirmed_18: true, marketing: false });
    const no = must(await admin.auth.admin.createUser({ email: `consent2-${rid().slice(0, 8)}@lovoki-it.test`, password: 'correct-horse-battery-1', email_confirm: true, user_metadata: { terms_version: TERMS_VERSION, confirm_18: 'false' } } as never)) as { user: { id: string } };
    expect(must(await admin.from('consents').select('*').eq('user_id', no.user.id)), 'no 18+ confirmation, no consent row').toHaveLength(0);
    for (const id of [ok.user.id, no.user.id]) await admin.auth.admin.deleteUser(id);
  });
  it('onboarding cannot complete without the new required fields, and says which', async () => {
    const U = await createUser('cnB', { complete: false });
    await rpc(U, 'save_basics', { p_display_name: 'x', p_date_of_birth: yearsAgo(30), p_pronouns: '' }); await rpc(U, 'save_preferences', { p_intention: 'long-term', p_interested_in: ['women'], p_age_min: 18, p_age_max: 60, p_max_distance: null });
    await addProfilePhoto(U);
    const r = await U.sb.rpc('complete_onboarding'); expect(r.error!.message).toMatch(/LOVOKI_ONBOARDING_INCOMPLETE:.*username.*gender.*place.*consent/);
    await setIdentity(U); await rpc(U, 'complete_onboarding');
  });
  it('nobody else can read your consent record', async () => {
    const A = await createUser('cnC'); const B = await createUser('cnD');
    expect(must(await B.sb.from('consents').select('*').eq('user_id', A.id))).toHaveLength(0);
    expect((await rawRest(B, 'POST', 'consents', { user_id: B.id, terms_version: 'x', confirmed_18: true })).status).toBeGreaterThanOrEqual(400);
  });
});

describe('places', () => {
  let U: TestUser;
  beforeAll(async () => { U = await createUser('plA', { complete: false }); });
  it('search_places finds by prefix, biggest first, and never returns coordinates', async () => {
    const hits = await rpc<{ id: number; name: string; label: string }[]>(U, 'search_places', { p_query: 'lisb' });
    expect(hits[0]).toMatchObject({ name: 'Lisbon' }); expect(hits[0]!.label).toMatch(/Lisbon.*Portugal/);
    expect(forbiddenKeys(hits)).toEqual([]); expect(Object.keys(hits[0]!).sort()).toEqual(['country', 'country_code', 'id', 'label', 'name', 'region']);
    expect(await rpc(U, 'search_places', { p_query: 'a' }), 'one letter is too short').toEqual([]);
    expect((await rpc<unknown[]>(U, 'search_places', { p_query: 'mu', p_limit: 500 })).length, 'limit is capped').toBeLessThanOrEqual(10);
    expect(await rpc(U, 'search_places', { p_query: "x'; drop table places;--" })).toEqual([]);
    expect((await rpc<{ name: string }[]>(U, 'search_places', { p_query: '%%' })).length, 'wildcards are not honoured').toBe(0);
    expect((await rawRest(null, 'POST', 'rpc/search_places', { p_query: 'lis' })).status).toBeGreaterThanOrEqual(400);
    expect((await rawRest(U, 'GET', 'places?select=*')).status, 'the table itself is closed').toBeGreaterThanOrEqual(400);
  });
  it('nearest_places maps a point to places, stores nothing, and validates the range', async () => {
    const near = await rpc<{ name: string }[]>(U, 'nearest_places', { p_lat: 38.72, p_lng: -9.14 }); expect(near[0]!.name).toBe('Lisbon'); expect(forbiddenKeys(near)).toEqual([]);
    expect((await rpc<unknown[]>(U, 'nearest_places', { p_lat: 40.4, p_lng: -3.7, p_limit: 99 })).length).toBeLessThanOrEqual(5);
    await rpcFails(U, 'nearest_places', { p_lat: 120, p_lng: 0 }, 'LOVOKI_INVALID');
    expect(must(await admin.from('profile_places').select('user_id').eq('user_id', U.id)), 'nothing was stored').toHaveLength(0);
  });
  it('save_place_id stores the place on a 5 km grid and sets the area label; unknown ids are refused', async () => {
    await rpc(U, 'save_place_id', { p_place_id: await placeId('madrid') });
    const row = must(await admin.from('profile_places').select('lat,lng,place_id').eq('user_id', U.id))[0] as { lat: number; lng: number };
    expect(Math.abs(Number(row.lat) * 20 - Math.round(Number(row.lat) * 20))).toBeLessThan(1e-6);
    expect(must(await admin.from('profiles').select('area_label').eq('user_id', U.id))[0]!.area_label).toMatch(/Madrid/);
    await rpcFails(U, 'save_place_id', { p_place_id: 424242424 }, 'LOVOKI_INVALID');
  });
});
const forbiddenKeys = (v: unknown): string[] => JSON.stringify(v).match(/"(lat|lng|latitude|longitude|coords?|population)"/gi) ?? [];

describe('profile details: validation', () => {
  let U: TestUser;
  beforeAll(async () => { U = await createUser('pdA'); });
  const save = (patch: Record<string, unknown>, vis: Record<string, string> = {}) => rpc(U, 'save_profile_details', { p_patch: patch, p_visibility: vis });
  const row = async () => must(await admin.from('profile_details').select('*').eq('user_id', U.id))[0] as Record<string, unknown>;

  it('instagram: @ and case are normalised, junk is refused', async () => {
    await save({ instagram_handle: '@Foo.Bar_9' }); expect((await row()).instagram_handle).toBe('foo.bar_9');
    for (const bad of ['a b', 'x'.repeat(31), 'dou..ble', 'sla/sh', 'emo😀']) await rpcFails(U, 'save_profile_details', { p_patch: { instagram_handle: bad } }, 'LOVOKI_INVALID');
    await save({ instagram_handle: '' }); expect((await row()).instagram_handle).toBeNull();
  });
  it('height: whole centimetres from 120 to 230, null clears', async () => {
    await save({ height_cm: 175 }); expect((await row()).height_cm).toBe(175);
    for (const bad of [119, 231, 180.5, '180', true, -1]) await rpcFails(U, 'save_profile_details', { p_patch: { height_cm: bad } }, 'LOVOKI_INVALID');
    await save({ height_cm: null }); expect((await row()).height_cm).toBeNull();
  });
  it('work and education: length limits and a fixed list', async () => {
    await save({ job_title: '  Nurse ', company_or_school: 'City Hospital', education_level: 'masters' }); expect(await row()).toMatchObject({ job_title: 'Nurse', company_or_school: 'City Hospital', education_level: 'masters' });
    await rpcFails(U, 'save_profile_details', { p_patch: { job_title: 'x'.repeat(61) } }, 'LOVOKI_INVALID'); await rpcFails(U, 'save_profile_details', { p_patch: { company_or_school: 'x'.repeat(61) } }, 'LOVOKI_INVALID');
    await rpcFails(U, 'save_profile_details', { p_patch: { education_level: 'wizard' } }, 'LOVOKI_INVALID');
    await save({ job_title: '', company_or_school: null }); expect(await row()).toMatchObject({ job_title: null, company_or_school: null });
  });
  it('languages: real ISO 639-1 codes only, at most 10, de-duplicated; the catalog has the Indian languages', async () => {
    await save({ languages: ['ta', 'ml', 'ta', 'hi', 'te', 'kn', 'en'] }); expect((await row()).languages).toEqual(['en', 'hi', 'kn', 'ml', 'ta', 'te']);
    await rpcFails(U, 'save_profile_details', { p_patch: { languages: ['xx'] } }, 'LOVOKI_INVALID');
    await rpcFails(U, 'save_profile_details', { p_patch: { languages: ['en', 'hi', 'ta', 'ml', 'te', 'kn', 'bn', 'mr', 'gu', 'pa', 'ur'] } }, 'LOVOKI_INVALID');
    await rpcFails(U, 'save_profile_details', { p_patch: { languages: 'en' } }, 'LOVOKI_INVALID');
    const codes = must(await U.sb.from('languages').select('code')).map((l) => l.code); for (const c of ['ta', 'ml', 'hi', 'te', 'kn', 'en', 'es', 'zh', 'ar']) expect(codes).toContain(c);
  });
  it('lifestyle, kids and structure are fixed lists (diet includes vegetarian, eggetarian, vegan, non-vegetarian)', async () => {
    await save({ drinking: 'socially', smoking: 'never', exercise: 'often', diet: 'eggetarian', pets: ['dog', 'cat'], has_kids: 'no', wants_kids: 'open', relationship_structure: 'ethical-non-monogamy' });
    expect(await row()).toMatchObject({ drinking: 'socially', smoking: 'never', exercise: 'often', diet: 'eggetarian', pets: ['cat', 'dog'], has_kids: 'no', wants_kids: 'open', relationship_structure: 'ethical-non-monogamy' });
    for (const d of ['vegetarian', 'vegan', 'non-vegetarian']) await save({ diet: d });
    for (const [k, v] of [['drinking', 'daily'], ['smoking', 'yes'], ['exercise', 'x'], ['diet', 'carnivore'], ['has_kids', 'maybe'], ['wants_kids', 'later'], ['relationship_structure', 'poly'], ['pets', ['dragon']]] as const) {
      await rpcFails(U, 'save_profile_details', { p_patch: { [k]: v } }, 'LOVOKI_INVALID');
    }
  });
  it('unknown fields and forbidden data have nowhere to go', async () => {
    for (const k of ['caste', 'income', 'net_worth', 'address', 'gps', 'government_id', 'health', 'sexual_history', 'immigration_status', 'biometric', 'user_id', 'visibility']) {
      await rpcFails(U, 'save_profile_details', { p_patch: { [k]: 'x' } }, 'LOVOKI_INVALID');
    }
    const cols = must(await admin.from('profile_details').select('*').eq('user_id', U.id).limit(1))[0] as Record<string, unknown>;
    expect(Object.keys(cols).filter((c) => /caste|income|worth|address|gps|government|health|sexual|immigration|biometric|ssn|aadhaar|passport/i.test(c)), 'no such column exists').toEqual([]);
  });
  it('religion is sensitive: needs an explicit opt-in in the same call, stays hidden by default, and clearing it resets visibility', async () => {
    await rpcFails(U, 'save_profile_details', { p_patch: { religion: 'jain' } }, 'LOVOKI_INVALID');
    await rpcFails(U, 'save_profile_details', { p_patch: { religion: 'jain', religion_optin: false } }, 'LOVOKI_INVALID');
    await rpcFails(U, 'save_profile_details', { p_patch: { religion: 'cult', religion_optin: true } }, 'LOVOKI_INVALID');
    await save({ religion: 'jain', religion_optin: true }); expect((await row()).religion).toBe('jain');
    expect(await rpc(U, 'check_username', { p_handle: 'zzzprobe' + rid().slice(0, 4) })).toBeTruthy();
    expect(((await row()).visibility as Record<string, string>).religion ?? 'X', 'hidden unless chosen').toBe('X');
    await save({}, { religion: 'P' }); expect(((await row()).visibility as Record<string, string>).religion).toBe('P');
    await save({ religion: null }); expect((await row()).religion).toBeNull(); expect((await row()).visibility).not.toHaveProperty('religion');
  });
  it('visibility values are validated; direct writes and other people’s rows are closed', async () => {
    await rpcFails(U, 'save_profile_details', { p_patch: {}, p_visibility: { height: 'everyone' } }, 'LOVOKI_INVALID');
    await rpcFails(U, 'save_profile_details', { p_patch: {}, p_visibility: { shoe_size: 'P' } }, 'LOVOKI_INVALID');
    const O = await createUser('pdB'); expect(must(await O.sb.from('profile_details').select('user_id')).every((r) => r.user_id === O.id)).toBe(true);
    expect((await rawRest(U, 'PATCH', `profile_details?user_id=eq.${U.id}`, { height_cm: 100 })).status).toBeGreaterThanOrEqual(400);
    expect((await rawRest(null, 'GET', 'profile_details?select=*')).status).toBeGreaterThanOrEqual(400);
  });
  it('the interests catalog is expanded', async () => { expect(must(await U.sb.from('interests').select('slug')).length).toBeGreaterThanOrEqual(70); });
});

describe('profile details: who can see what', () => {
  // Owner O (public profile, man) with everything filled in. S: compatible stranger. Fo: accepted follower (not a match). M: a match. K: blocked.
  let O: TestUser, S: TestUser, Fo: TestUser, M: TestUser, K: TestUser, N: TestUser;
  const ALL = { instagram_handle: 'owner.insta', height_cm: 180, job_title: 'Nurse', company_or_school: 'City Hospital', education_level: 'masters', languages: ['ta', 'en'], drinking: 'never', smoking: 'never', exercise: 'often', diet: 'vegan', pets: ['dog'], has_kids: 'no', wants_kids: 'open', relationship_structure: 'monogamy', religion: 'sikh', religion_optin: true };
  const setVis = (vis: Record<string, string>) => rpc(O, 'save_profile_details', { p_patch: {}, p_visibility: vis });
  beforeAll(async () => {
    [O, S, Fo, M, K, N] = await Promise.all([datingUser('vdO', { social: 'public', gender: 'man', interestedIn: ['women'] }), datingUser('vdS', { social: 'public', gender: 'woman', interestedIn: ['men'] }),
      datingUser('vdF', { social: 'public', gender: 'woman', interestedIn: ['men'] }), datingUser('vdM', { social: 'public', gender: 'woman', interestedIn: ['men'] }),
      datingUser('vdK', { social: 'public', gender: 'woman', interestedIn: ['men'] }), datingUser('vdN', { social: 'public', gender: 'woman', interestedIn: ['women'] })]);
    await rpc(O, 'save_profile_details', { p_patch: ALL }); await rpc(Fo, 'follow_user', { p_user: O.id });
    await like(O, M); await like(M, O); await rpc(O, 'block_user', { p_user: K.id });
  });
  const P_FIELDS = ['height_cm', 'education_level', 'languages', 'drinking', 'smoking', 'exercise', 'diet', 'pets', 'has_kids', 'wants_kids', 'relationship_structure'];

  it('defaults: P fields are visible to eligible strangers; instagram and work are matches-only; religion is private', async () => {
    for (const [who, label] of [[S, 'stranger'], [Fo, 'follower']] as const) {
      const soc = await details(who, O); const dat = who === S ? await dDetails(who, O) : {};
      for (const k of P_FIELDS) expect(soc, `${label} sees ${k} (social)`).toHaveProperty(k);
      for (const k of ['instagram_handle', 'job_title', 'company_or_school', 'religion']) expect(soc, `${label} must not see ${k}`).not.toHaveProperty(k);
      if (who === S) { for (const k of P_FIELDS) expect(dat).toHaveProperty(k); for (const k of ['instagram_handle', 'job_title', 'religion']) expect(dat).not.toHaveProperty(k); }
    }
    const asMatch = await dDetails(M, O); expect(asMatch).toMatchObject({ instagram_handle: 'owner.insta', job_title: 'Nurse', company_or_school: 'City Hospital' }); expect(asMatch).not.toHaveProperty('religion');
    expect(await details(M, O)).toMatchObject({ instagram_handle: 'owner.insta' });
    expect(await details(O, O), 'the owner always sees everything').toMatchObject({ religion: 'sikh', instagram_handle: 'owner.insta' });
  });
  it('blocked people and people who cannot see the profile get nothing', async () => {
    expect(await rpc(K, 'social_profile', { p_user: O.id })).toEqual([]); expect(await rpc(K, 'dating_profile', { p_user: O.id })).toEqual([]);
    expect(await dDetails(N, O), 'an incompatible person is not even eligible').toEqual({});
  });
  it('F shows a field to accepted followers only; X hides it from everyone but you; P opens M fields; M closes P fields to non-matches', async () => {
    await setVis({ height: 'F', education: 'X', work: 'P', instagram: 'P', languages: 'M' });
    const st = await details(S, O), fo = await details(Fo, O), ma = await details(M, O);
    expect(st).not.toHaveProperty('height_cm'); expect(fo).toHaveProperty('height_cm'); expect(ma, 'a match who does not follow does not satisfy F').not.toHaveProperty('height_cm');
    for (const d of [st, fo, ma]) expect(d, 'X is private to the owner').not.toHaveProperty('education_level');
    expect(st).toMatchObject({ job_title: 'Nurse', instagram_handle: 'owner.insta' });
    expect(st).not.toHaveProperty('languages'); expect(ma).toHaveProperty('languages');
    expect(await details(O, O)).toHaveProperty('education_level');
    await setVis({ height: 'P', education: 'P', work: 'M', instagram: 'M', languages: 'P' });
  });
  it('religion can be shown only after an explicit choice, and is never filterable', async () => {
    expect(await details(S, O)).not.toHaveProperty('religion'); await setVis({ religion: 'P' });
    expect(await details(S, O)).toMatchObject({ religion: 'sikh' }); await setVis({ religion: 'X' }); expect(await details(S, O)).not.toHaveProperty('religion');
    const cols = must(await admin.from('dating_preferences').select('*').eq('user_id', S.id))[0] as Record<string, unknown>;
    expect(Object.keys(cols).filter((c) => /religion/i.test(c))).toEqual([]);
  });
  it('a followers-only profile shows nothing optional to strangers, and the P rule follows the follower rule', async () => {
    const F = await datingUser('vdFO', { social: 'followers', gender: 'man', interestedIn: ['women'] }); await rpc(F, 'save_profile_details', { p_patch: { height_cm: 170, drinking: 'never' } });
    expect(await details(S, F)).toEqual({}); await rpc(Fo, 'follow_user', { p_user: F.id }); await rpc(F, 'respond_follow_request', { p_follower: Fo.id, p_accept: true });
    expect(await details(Fo, F)).toMatchObject({ height_cm: 170, drinking: 'never' });
    expect(await dDetails(S, F), 'in the dating context an eligible stranger still sees P fields').toMatchObject({ height_cm: 170 });
  });
  it('no response anywhere carries coordinates, a birth date, or a field that should be hidden', async () => {
    const all = [await rpc(S, 'social_profile', { p_user: O.id }), await rpc(S, 'dating_profile', { p_user: O.id }), await rpc(Fo, 'social_profile', { p_user: O.id }), await rpc(S, 'discover_profiles', { p_limit: 20 })];
    const text = JSON.stringify(all); expect(text).not.toMatch(/date_of_birth|"lat"|"lng"|sikh|owner\.insta|City Hospital/);
    expect(JSON.stringify(await rpc(M, 'list_matches', { p_limit: 20 }))).toMatch(/owner\.insta/);
  });
});

describe('gender, avatar and settings', () => {
  it('self-describe needs a label (30 characters at most), is hidden with the gender label, and matches like non-binary', async () => {
    const U = await createUser('gdA', { complete: false });
    await rpcFails(U, 'save_dating_profile', { p_gender: 'self-describe', p_show_gender: true, p_show_distance: true }, 'LOVOKI_INVALID');
    await rpcFails(U, 'save_dating_profile', { p_gender: 'self-describe', p_show_gender: true, p_show_distance: true, p_gender_custom: 'x'.repeat(31) }, 'LOVOKI_INVALID');
    await rpcFails(U, 'save_dating_profile', { p_gender: 'robot', p_show_gender: true, p_show_distance: true }, 'LOVOKI_INVALID');
    const W = await datingUser('gdW', { gender: 'woman', interestedIn: ['non-binary'] }); const X = await datingUser('gdX', { gender: 'self-describe' as never, interestedIn: ['women'] });
    expect(must(await admin.from('profiles').select('gender').eq('user_id', X.id))[0]!.gender).toBe('self-describe');
    await rpc(X, 'save_dating_profile', { p_gender: 'self-describe', p_show_gender: true, p_show_distance: true, p_gender_custom: 'Genderfluid' });
    expect(await rpc(W, 'dating_profile', { p_user: X.id })).toMatchObject([{ gender: 'self-describe', gender_custom: 'Genderfluid' }]);
    await rpc(X, 'save_dating_profile', { p_gender: 'self-describe', p_show_gender: false, p_show_distance: true, p_gender_custom: 'Genderfluid' });
    expect(await rpc(W, 'dating_profile', { p_user: X.id })).toMatchObject([{ gender: null, gender_custom: null }]);
    await rpc(X, 'save_dating_profile', { p_gender: 'man', p_show_gender: true, p_show_distance: true }); expect(must(await admin.from('profiles').select('gender_custom').eq('user_id', X.id))[0]!.gender_custom, 'the label is dropped when you pick a fixed gender').toBeNull();
  });
  it('avatar: a chosen own photo with a square crop; the main photo is the default; others’ photos and bad crops are refused', async () => {
    const A = await datingUser('avA', { social: 'public' }); const B = await datingUser('avB', { social: 'public' });
    const second = await addProfilePhoto(A); const [main] = must(await A.sb.from('profile_photos').select('id,storage_path').order('position'));
    expect((await rpc<{ photo_path: string }[]>(B, 'social_profile', { p_user: A.id }))[0]!.photo_path).toBe(main!.storage_path);
    await rpc(A, 'save_avatar', { p_photo_id: second.photoId, p_crop: { x: 0.25, y: 0.75, zoom: 1.5 } });
    expect(await rpc(B, 'social_profile', { p_user: A.id })).toMatchObject([{ photo_path: second.path, avatar_crop: { x: 0.25, y: 0.75, zoom: 1.5 } }]);
    const theirs = must(await B.sb.from('profile_photos').select('id'))[0]!.id; await rpcFails(A, 'save_avatar', { p_photo_id: theirs, p_crop: { x: 0.5, y: 0.5, zoom: 1 } }, 'LOVOKI_INVALID');
    for (const crop of [{ x: 2, y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 9 }, { x: 'a', y: 0, zoom: 1 }, 'nope']) await rpcFails(A, 'save_avatar', { p_photo_id: second.photoId, p_crop: crop }, 'LOVOKI_INVALID');
    await rpc(A, 'delete_photo', { p_id: second.photoId }); expect((await rpc<{ photo_path: string }[]>(B, 'social_profile', { p_user: A.id }))[0]!.photo_path, 'falls back to the main photo').toBe(main!.storage_path);
    await rpc(A, 'save_avatar', { p_photo_id: null, p_crop: null }); expect(must(await admin.from('profiles').select('avatar_crop').eq('user_id', A.id))[0]!.avatar_crop).toBeNull();
  });
  it('allow_comments: everyone, followers or nobody (the author can always comment); the feed says whether you may', async () => {
    const O = await createUser('acO'); const F = await createUser('acF'); const S = await createUser('acS'); await rpc(F, 'follow_user', { p_user: O.id });
    const p = await post(O, 'comment settings');
    const may = async (u: TestUser) => (await rpc<{ comments_allowed: boolean }[]>(u, 'post_page', { p_post: p }))[0]!.comments_allowed;
    expect([await may(S), await may(F), await may(O)]).toEqual([true, true, true]);
    await rpc(O, 'save_social_settings', { p_allow_comments: 'followers', p_show_follower_counts: true });
    expect([await may(S), await may(F), await may(O)]).toEqual([false, true, true]); await rpcFails(S, 'add_comment', { p_post: p, p_body: 'hi' }, 'LOVOKI_COMMENTS_OFF'); await rpc(F, 'add_comment', { p_post: p, p_body: 'hi' });
    await rpc(O, 'save_social_settings', { p_allow_comments: 'nobody', p_show_follower_counts: true });
    expect([await may(S), await may(F), await may(O)]).toEqual([false, false, true]); await rpcFails(F, 'add_comment', { p_post: p, p_body: 'no' }, 'LOVOKI_COMMENTS_OFF'); await rpc(O, 'add_comment', { p_post: p, p_body: 'mine' });
    await rpcFails(O, 'save_social_settings', { p_allow_comments: 'friends', p_show_follower_counts: true }, 'LOVOKI_INVALID');
  });
  it('show_follower_counts hides counts from others but never from you', async () => {
    const O = await createUser('fcO'); const V = await createUser('fcV'); await rpc(V, 'follow_user', { p_user: O.id });
    expect((await rpc<{ follower_count: number }[]>(V, 'social_profile', { p_user: O.id }))[0]!.follower_count).toBe(1);
    await rpc(O, 'save_social_settings', { p_allow_comments: 'everyone', p_show_follower_counts: false });
    expect(await rpc(V, 'social_profile', { p_user: O.id })).toMatchObject([{ follower_count: null, following_count: null }]);
    expect(await rpc(O, 'social_profile', { p_user: O.id })).toMatchObject([{ follower_count: 1 }]);
  });
  it('post_page returns one post the viewer may see, and nothing for a post they may not (the same as for an unknown id)', async () => {
    const O = await createUser('ppO', { visibility: 'followers' }); const S = await createUser('ppS'); const id = await post(O, 'single', 'followers');
    expect(await rpc(O, 'post_page', { p_post: id })).toHaveLength(1); expect(await rpc(S, 'post_page', { p_post: id })).toEqual([]); expect(await rpc(S, 'post_page', { p_post: rid() })).toEqual([]);
    expect((await rawRest(null, 'POST', 'rpc/post_page', { p_post: id })).status).toBeGreaterThanOrEqual(400);
  });
});

describe('soft filters on optional fields', () => {
  it('apply only to my queue, only to fields people chose to show me, and never change who is eligible', async () => {
    const V = await datingUser('sfV', { gender: 'woman', interestedIn: ['men'] });
    const tall = await datingUser('sfT', { gender: 'man', interestedIn: ['women'] }); const short = await datingUser('sfS', { gender: 'man', interestedIn: ['women'] });
    const hidden = await datingUser('sfH', { gender: 'man', interestedIn: ['women'] }); const unknown = await datingUser('sfU', { gender: 'man', interestedIn: ['women'] });
    await rpc(tall, 'save_profile_details', { p_patch: { height_cm: 190, drinking: 'never', smoking: 'never', wants_kids: 'yes' } });
    await rpc(short, 'save_profile_details', { p_patch: { height_cm: 160, drinking: 'often', smoking: 'regularly', wants_kids: 'no' } });
    await rpc(hidden, 'save_profile_details', { p_patch: { height_cm: 190, drinking: 'never', smoking: 'never', wants_kids: 'yes' }, p_visibility: { height: 'X', lifestyle: 'X', kids: 'X' } });
    const ids = async () => (await rpc<{ user_id: string }[]>(V, 'discover_profiles', { p_limit: 20 })).map((c) => c.user_id).filter((i) => [tall, short, hidden, unknown].some((u) => u.id === i));
    const f = (o: Record<string, unknown>) => rpc(V, 'save_dating_filters', { p_intentions: [], p_interests: [], ...o });
    expect((await ids()).sort()).toEqual([tall, short, hidden, unknown].map((u) => u.id).sort());
    await f({ p_height_min: 180 }); expect(await ids(), 'a hidden or empty height never satisfies a height filter').toEqual([tall.id]);
    await f({ p_height_min: 150, p_height_max: 170 }); expect(await ids()).toEqual([short.id]);
    await f({ p_drinking: ['never'] }); expect(await ids()).toEqual([tall.id]); await f({ p_smoking: ['regularly', 'sometimes'] }); expect(await ids()).toEqual([short.id]);
    await f({ p_kids: ['yes', 'open'] }); expect(await ids()).toEqual([tall.id]);
    expect(await rpc(V, 'dating_profile', { p_user: hidden.id }), 'filters never change eligibility').toHaveLength(1);
    expect(await rpc(hidden, 'dating_profile', { p_user: V.id }), 'and never affect the other side').toHaveLength(1);
    await f({}); expect((await ids()).length).toBe(4);
    await rpcFails(V, 'save_dating_filters', { p_intentions: [], p_interests: [], p_height_min: 100 }, 'LOVOKI_INVALID');
    await rpcFails(V, 'save_dating_filters', { p_intentions: [], p_interests: [], p_height_min: 190, p_height_max: 170 }, 'LOVOKI_INVALID');
    await rpcFails(V, 'save_dating_filters', { p_intentions: [], p_interests: [], p_drinking: ['daily'] }, 'LOVOKI_INVALID');
    await rpcFails(V, 'save_dating_filters', { p_intentions: [], p_interests: [], p_kids: ['maybe'] }, 'LOVOKI_INVALID');
  });
});

describe('anonymous and direct access', () => {
  it('every new function is closed to anonymous callers, and the new tables to direct client writes', async () => {
    for (const fn of ['check_username', 'set_username', 'resolve_username', 'record_consent', 'set_marketing_consent', 'search_places', 'nearest_places', 'save_place_id', 'my_place',
      'save_profile_details', 'save_avatar', 'save_social_settings', 'post_page']) expect((await rawRest(null, 'POST', `rpc/${fn}`, {})).status, fn).toBeGreaterThanOrEqual(400);
    const U = await createUser('anA');
    for (const [fn, args] of [['_can_see_field', { viewer: U.id, owner: U.id, k: 'height', ctx: 'social' }], ['_visible_details', { viewer: U.id, owner: U.id, ctx: 'social' }], ['_handle_status', { h: 'abc', me: U.id }], ['_avatar_path', { owner: U.id }]] as const) {
      expect((await rawRest(U, 'POST', `rpc/${fn}`, args)).status, `${fn} is internal`).toBeGreaterThanOrEqual(400);
    }
    for (const t of ['places', 'username_history']) for (const m of ['POST', 'DELETE'] as const) expect((await rawRest(U, m, t, m === 'POST' ? { id: 1 } : undefined)).status, `${m} ${t}`).toBeGreaterThanOrEqual(400);
    expect(URL_).toBeTruthy();
  });
});
