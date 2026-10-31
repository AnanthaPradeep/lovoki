// INTEGRATION: Phase 2 security against the real local stack (GoTrue, PostgREST, Storage, Postgres RLS).
import { beforeAll, describe, expect, it } from 'vitest';
import { PNG, JPEG, admin, addProfilePhoto, bigJpeg, createUser, must, rawRest, rid, rpc, rpcFails, type TestUser } from './harness';

let A: TestUser, B: TestUser, N: TestUser; // N = new user who has not completed onboarding
const TABLES = ['profiles', 'profiles_private', 'dating_preferences', 'onboarding_state', 'profile_interests', 'profile_prompts', 'profile_photos'];

beforeAll(async () => {
  A = await createUser('alice'); B = await createUser('bob'); N = await createUser('newbie', { complete: false });
  await rpc(A, 'save_about', { p_bio: 'a', p_interests: ['coffee'], p_prompts: [{ question: 'Q', answer: 'A' }] });
  await rpc(B, 'save_about', { p_bio: 'b', p_interests: ['jazz'], p_prompts: [{ question: 'Q', answer: 'B' }] });
});

describe('RLS isolation on every Phase 2 table', () => {
  for (const t of TABLES) {
    it(`${t}: each user reads only their own rows`, async () => {
      const a = must(await A.sb.from(t).select('*'), t) as { user_id: string }[];
      const b = must(await B.sb.from(t).select('*'), t) as { user_id: string }[];
      expect(a.length, `${t} A rows`).toBeGreaterThan(0);
      expect(a.every((r) => r.user_id === A.id), `${t}: A sees only A`).toBe(true);
      expect(b.every((r) => r.user_id === B.id), `${t}: B sees only B`).toBe(true);
      const cross = must(await A.sb.from(t).select('*').eq('user_id', B.id), t);
      expect(cross, `${t}: A asking for B rows`).toHaveLength(0);
    });
    it(`${t}: anonymous callers are denied`, async () => {
      const r = await rawRest(null, 'GET', `${t}?select=*`);
      expect(r.status, `${t} anon status`).toBeGreaterThanOrEqual(400);
    });
  }
  it('interests catalogue is readable by signed-in users only', async () => {
    expect(must(await A.sb.from('interests').select('slug').limit(1))).toHaveLength(1);
    expect((await rawRest(null, 'GET', 'interests?select=slug')).status).toBeGreaterThanOrEqual(400);
  });
});

describe('direct writes are denied (PostgREST)', () => {
  // Each payload would SUCCEED if the privilege or a policy existed (no key collisions), and the stored rows are compared
  // through the service role afterwards, so a rejected request that still changed data cannot pass.
  const snap = async (t: string, id: string) => JSON.stringify(must(await admin.from(t).select('*').eq('user_id', id)));
  const UPDATES: Record<string, Record<string, unknown>> = {
    profiles: { bio: 'HACKED' }, profiles_private: { date_of_birth: '1980-01-01' }, dating_preferences: { age_min: 30 },
    onboarding_state: { current_step: 'review', completed_at: '2020-01-01T00:00:00Z' }, profile_prompts: { answer: 'HACKED' }, profile_photos: { position: 5 },
  };
  for (const t of TABLES) {
    it(`${t}: update, delete and insert are refused and change nothing`, async () => {
      const before = await snap(t, A.id);
      if (UPDATES[t]) {
        const r = await rawRest(A, 'PATCH', `${t}?user_id=eq.${A.id}`, UPDATES[t]);
        expect(r.status, `PATCH ${t} own row: ${r.text}`).toBeGreaterThanOrEqual(400);
      }
      const d = await rawRest(A, 'DELETE', `${t}?user_id=eq.${A.id}`);
      expect(d.status, `DELETE ${t} own row: ${d.text}`).toBeGreaterThanOrEqual(400);
      const o = await rawRest(A, 'DELETE', `${t}?user_id=eq.${B.id}`);
      expect(o.status, `DELETE ${t} other row: ${o.text}`).toBeGreaterThanOrEqual(400);
      expect(await snap(t, A.id), `${t}: A rows unchanged`).toBe(before);
      expect(must(await admin.from(t).select('user_id').eq('user_id', B.id)).length, `${t}: B rows still exist`).toBeGreaterThan(0);
    });
    it(`${t}: a user with no row cannot insert one`, async () => {
      const X = await createUser(`ins-${t.slice(0, 8)}`, { complete: false });
      const rows: Record<string, Record<string, unknown>> = {
        profile_interests: { user_id: X.id, slug: 'coffee' }, profile_prompts: { user_id: X.id, position: 1, question: 'Q', answer: 'A' },
        profile_photos: { user_id: X.id, storage_path: `${X.id}/${rid()}.png`, position: 0, content_type: 'image/png', size_bytes: 10 },
      };
      if (!rows[t]) must(await admin.from(t).delete().eq('user_id', X.id));
      const r = await rawRest(X, 'POST', t, rows[t] ?? { user_id: X.id });
      expect(r.status, `POST ${t}: ${r.text}`).toBeGreaterThanOrEqual(400);
      const has = must(await admin.from(t).select('user_id').eq('user_id', X.id)).length;
      expect(has, `${t}: row count for X after the insert attempt`).toBe(0);
    });
  }
  it('interests catalogue: insert, update and delete are refused', async () => {
    for (const [m, path, body] of [['POST', 'interests', { slug: 'evil', label: 'Evil' }], ['PATCH', 'interests?slug=eq.coffee', { label: 'HACKED' }], ['DELETE', 'interests?slug=eq.coffee', undefined]] as const) {
      expect((await rawRest(A, m, path, body)).status, `${m} interests`).toBeGreaterThanOrEqual(400);
    }
    expect(must(await admin.from('interests').select('label').eq('slug', 'coffee').single()).label).toBe('Coffee');
  });
  it('completed_at cannot be set directly', async () => {
    const r = await rawRest(N, 'PATCH', `onboarding_state?user_id=eq.${N.id}`, { completed_at: new Date().toISOString() });
    expect(r.status, r.text).toBeGreaterThanOrEqual(400);
    const row = must(await admin.from('onboarding_state').select('completed_at').eq('user_id', N.id).single());
    expect(row.completed_at).toBeNull();
  });
});

describe('views never expose date of birth', () => {
  it('public_profiles has explicit columns and an age; the old discoverable_profiles view no longer exists (Phase 4 removed it)', async () => {
    expect((await A.sb.from('discoverable_profiles').select('*').limit(1)).error, 'view must be gone').not.toBeNull();
    for (const v of ['public_profiles']) {
      const rows = must(await A.sb.from(v).select('*').limit(5)) as Record<string, unknown>[];
      for (const r of rows) {
        expect(Object.keys(r), `${v} columns`).not.toContain('date_of_birth');
        expect(Object.keys(r), `${v} columns`).not.toContain('dob');
      }
      const bad = await A.sb.from(v).select('date_of_birth').limit(1);
      expect(bad.error, `${v}.date_of_birth must not exist`).not.toBeNull();
    }
    const rows = must(await A.sb.from('public_profiles').select('user_id,age').eq('user_id', B.id)) as { age: number }[];
    expect(rows[0]!.age).toBeGreaterThanOrEqual(18);
  });
  it('anonymous callers cannot read the views', async () => {
    expect((await rawRest(null, 'GET', 'public_profiles?select=*')).status).toBeGreaterThanOrEqual(400);
  });
  it('a followers-only or incomplete profile is absent from public_profiles', async () => {
    const F = await createUser('fo', { visibility: 'followers' });
    expect(must(await A.sb.from('public_profiles').select('user_id').eq('user_id', F.id))).toHaveLength(0);
    expect(must(await A.sb.from('public_profiles').select('user_id').eq('user_id', N.id))).toHaveLength(0);
  });
});

describe('server-side validation', () => {
  it('under-18 date of birth is rejected by the database', async () => {
    const y = new Date().getUTCFullYear() - 17;
    await rpcFails(N, 'save_basics', { p_display_name: 'Kid', p_date_of_birth: `${y}-01-01`, p_pronouns: '' }, 'LOVOKI_UNDER_18');
  });
  it('date of birth locks after onboarding completes', async () => {
    await rpcFails(A, 'save_basics', { p_display_name: 'alice', p_date_of_birth: '1990-01-01', p_pronouns: '' }, 'LOVOKI_DOB_LOCKED');
  });
  it('complete_onboarding lists what is missing', async () => {
    await rpcFails(N, 'complete_onboarding', {}, 'LOVOKI_ONBOARDING_INCOMPLETE');
  });
  it('unauthenticated callers cannot run account functions', async () => {
    const r = await fetch(`${process.env.LOVOKI_IT_URL}/rest/v1/rpc/ensure_account`, { method: 'POST', headers: { apikey: process.env.LOVOKI_IT_ANON!, 'Content-Type': 'application/json' }, body: '{}' });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe('signup trigger and ensure_account repair', () => {
  it('a new auth user gets every account row from the trigger alone', async () => {
    for (const t of ['profiles', 'profiles_private', 'dating_preferences', 'onboarding_state']) {
      expect(must(await admin.from(t).select('user_id').eq('user_id', N.id)), `${t} row created by trigger`).toHaveLength(1);
    }
  });
  it('ensure_account recreates deleted rows and is idempotent', async () => {
    for (const t of ['profiles', 'dating_preferences', 'onboarding_state', 'profiles_private']) must(await admin.from(t).delete().eq('user_id', N.id));
    await rpc(N, 'ensure_account'); await rpc(N, 'ensure_account');
    for (const t of ['profiles', 'profiles_private', 'dating_preferences', 'onboarding_state']) {
      expect(must(await admin.from(t).select('user_id').eq('user_id', N.id)), `${t} repaired once`).toHaveLength(1);
    }
  });
});

describe('profile-photos storage rules', () => {
  it('upload into another user folder is denied', async () => {
    const r = await A.sb.storage.from('profile-photos').upload(`${B.id}/${rid()}.png`, PNG, { contentType: 'image/png' });
    expect(r.error, 'A must not write into B folder').not.toBeNull();
  });
  it('names that are not <uid>/<uuid>.<ext> are denied', async () => {
    for (const name of [`${A.id}/chosen-name.png`, `${A.id}/${rid()}.gif`, `${A.id}/sub/${rid()}.png`, `${rid()}.png`]) {
      const r = await A.sb.storage.from('profile-photos').upload(name, PNG, { contentType: 'image/png' });
      expect(r.error, `name ${name} must be refused`).not.toBeNull();
    }
  });
  it('an existing object cannot be overwritten', async () => {
    const path = `${A.id}/${rid()}.png`;
    must(await A.sb.storage.from('profile-photos').upload(path, PNG, { contentType: 'image/png' }));
    const again = await A.sb.storage.from('profile-photos').upload(path, JPEG, { contentType: 'image/jpeg', upsert: true });
    expect(again.error, 'upsert over an existing object must fail').not.toBeNull();
    const plain = await A.sb.storage.from('profile-photos').upload(path, JPEG, { contentType: 'image/jpeg' });
    expect(plain.error, 'duplicate name must fail').not.toBeNull();
  });
  it('size and MIME limits are enforced by the bucket', async () => {
    const big = await A.sb.storage.from('profile-photos').upload(`${A.id}/${rid()}.jpg`, bigJpeg(5 * 1024 * 1024 + 1), { contentType: 'image/jpeg' });
    expect(big.error, 'over 5 MB must be refused').not.toBeNull();
    const txt = await A.sb.storage.from('profile-photos').upload(`${A.id}/${rid()}.png`, new TextEncoder().encode('hello'), { contentType: 'text/plain' });
    expect(txt.error, 'text/plain must be refused').not.toBeNull();
  });
  it('per-user object cap (12) holds without policy recursion', async () => {
    const C = await createUser('capper', { complete: false });
    let ok = 0, last = '';
    for (let i = 0; i < 14; i++) {
      const r = await C.sb.storage.from('profile-photos').upload(`${C.id}/${rid()}.png`, PNG, { contentType: 'image/png' });
      if (!r.error) ok++; else last = r.error.message;
    }
    expect(ok, `uploads accepted (last error: ${last})`).toBe(12);
    expect(last).not.toMatch(/recursion/i);
  });
  it('KNOWN LIMITATION: the object cap is soft under parallel uploads, the photo table is not', async () => {
    const C = await createUser('capper2', { complete: false });
    const results = await Promise.all(Array.from({ length: 30 }, () => C.sb.storage.from('profile-photos').upload(`${C.id}/${rid()}.png`, PNG, { contentType: 'image/png' })));
    const accepted = results.filter((r) => !r.error).length;
    expect(accepted, 'at least the cap, never more than attempted').toBeGreaterThanOrEqual(12);
    // How many exceed the cap depends on timing (it can be all of them under load): that is exactly the documented limitation.
    const paths = results.filter((r) => !r.error).map((r) => r.data!.path);
    const reg = await Promise.allSettled(paths.slice(0, 8).map((p) => rpc(C, 'register_photo', { p_path: p })));
    expect(reg.filter((r) => r.status === 'fulfilled').length, 'register_photo is hard-capped at 6 even when raced').toBeLessThanOrEqual(6);
    expect(must(await admin.from('profile_photos').select('id').eq('user_id', C.id)).length).toBeLessThanOrEqual(6);
  });
  it('register_photo reads type and size from the stored object, not the client', async () => {
    const C = await createUser('reg', { complete: false });
    const { photoId } = await addProfilePhoto(C);
    const row = must(await admin.from('profile_photos').select('content_type,size_bytes').eq('id', photoId).single());
    expect(row.content_type).toBe('image/png');
    expect(row.size_bytes).toBe(PNG.byteLength);
  });
  it('register_photo rejects unuploaded paths, foreign paths and bad shapes', async () => {
    await rpcFails(N, 'register_photo', { p_path: `${N.id}/${rid()}.png` }, 'LOVOKI_PHOTO_MISSING');
    await rpcFails(N, 'register_photo', { p_path: `${B.id}/${rid()}.png` }, 'LOVOKI_INVALID');
    await rpcFails(N, 'register_photo', { p_path: `${N.id}/nope.png` }, 'LOVOKI_INVALID');
  });
  it('another user can read a photo only while the profile is visible', async () => {
    const { path } = await addProfilePhoto(B);
    expect((await A.sb.storage.from('profile-photos').createSignedUrl(path, 60)).error, 'public completed profile: readable').toBeNull();
    expect((await N.sb.storage.from('profile-photos').createSignedUrl(path, 60)).error, 'viewer without completed profile: denied').not.toBeNull();
    await rpc(B, 'save_privacy', { p_area_label: 'Lisbon', p_social_visibility: 'followers', p_dating_discoverable: false });
    expect((await A.sb.storage.from('profile-photos').createSignedUrl(path, 60)).error, 'followers-only, not following: denied').not.toBeNull();
    await rpc(B, 'save_privacy', { p_area_label: 'Lisbon', p_social_visibility: 'public', p_dating_discoverable: false });
  });
  it('a user can delete only their own objects', async () => {
    const { path } = await addProfilePhoto(B);
    await A.sb.storage.from('profile-photos').remove([path]);
    expect((await admin.storage.from('profile-photos').download(path)).error, 'B object must still exist').toBeNull();
  });
});
