// DEV/TEST ONLY. Loaded only by `vite --mode uitest`. Drives the real-mode UI with in-memory fakes, persisted
// to localStorage so refresh/resume can be tested. This is NOT Supabase and never ships in a production build.
import { FakeAccountApi, FakeAuthApi, FakeDatingApi, FakeDatingWorld, FakeSocialApi, FakeSocialWorld, FAKE_PLACES, fakePlaceById, type AuthUser } from '@lovoki/core';
import { RealAppView } from './RealApp';

const KEY = 'lovoki.uitest.state';
const auth = new FakeAuthApi();
auth.latencyMs = 200; // realistic enough that in-flight states (and the duplicate-submit guard) are observable
const accounts = new Map<string, FakeAccountApi>();

// Fictional people for the social screens, only in this dev harness. Fixed ids so a refresh keeps them.
const world = new FakeSocialWorld();
const SEED = {
  ana: '00000000-0000-4000-8000-0000000000a1', ben: '00000000-0000-4000-8000-0000000000b2', cleo: '00000000-0000-4000-8000-0000000000c3',
};
function seedWorld() {
  const mk = (id: string, name: string, visibility: 'public' | 'followers') => { world.users.set(id, { id, name, visibility, bio: `Test profile: ${name}`, age: 31, completed: true }); };
  mk(SEED.ana, 'Ana Test', 'public'); mk(SEED.ben, 'Ben Test', 'followers'); mk(SEED.cleo, 'Cleo Test', 'public');
  for (let i = 1; i <= 18; i++) world.addPost(SEED.ana, `Ana public post ${i}`, 'public', i % 3 === 0);
  world.addPost(SEED.ana, 'Ana followers-only post', 'followers');
  world.addPost(SEED.ben, 'Ben post (his profile is followers-only)', 'public');
  world.addPost(SEED.cleo, 'Cleo says hello with a very long unbroken string ' + 'x'.repeat(150), 'public');
}
seedWorld();

// Dating: fictional adults for the dev harness only. Rita Test has already liked every new account, so a mutual match can be tried at once.
const dworld = new FakeDatingWorld(world);
const DSEED = { rita: '00000000-0000-4000-8000-0000000000d1' };
const PLACES = FAKE_PLACES.slice(0, 4);
const INTENTIONS = ['long-term', 'friends-first', 'figuring-out', 'short-term-open'];
function seedDating() {
  world.users.set(DSEED.rita, { id: DSEED.rita, name: 'Rita Test', visibility: 'public', bio: 'Test person from the dev harness.', age: 29, completed: true });
  dworld.setDating(DSEED.rita, { gender: 'woman', interestedIn: ['women', 'men', 'non-binary'], place: PLACES[0]!, intention: 'long-term', interests: ['jazz'], bio: 'Test person from the dev harness.', pronouns: 'she/her',
    prompts: [{ question: 'A perfect Sunday', answer: 'Coffee, a long walk and no plans.' }] });
  for (let i = 1; i <= 24; i++) {
    const id = `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`;
    world.users.set(id, { id, name: `Dating Test ${i}`, visibility: 'public', bio: `Test profile number ${i}.`, age: 24 + (i % 12), completed: true });
    dworld.setDating(id, { gender: (['woman', 'man', 'non-binary'] as const)[i % 3]!, interestedIn: ['women', 'men', 'non-binary'], place: PLACES[i % 4]!, intention: INTENTIONS[i % 4]!,
      interests: [['jazz', 'coffee'], ['coffee'], ['hiking'], ['film', 'jazz']][i % 4]!, bio: i === 3 ? 'A very long unbroken string ' + 'z'.repeat(160) : `Test profile number ${i}.`, pronouns: 'they/them',
      prompts: [{ question: 'I geek out on', answer: `Test thing number ${i}.` }], discoverable: true });
  }
}
seedDating();

try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const s = JSON.parse(raw) as { users: [string, { id: string; password: string; confirmed: boolean }][]; current: AuthUser | null; accounts: [string, FakeAccountApi['account']][]; consents?: [string, { termsVersion: string; marketing: boolean }][] };
    auth.users = new Map(s.users); auth.current = s.current; auth.consents = new Map(s.consents ?? []);
    s.accounts.forEach(([id, a]) => { const f = new FakeAccountApi(id, a.email); f.latencyMs = 120; f.account = a; accounts.set(id, f); });
  }
  const w = localStorage.getItem(KEY + '.world');
  if (w) world.restore(JSON.parse(w));
  const dw = localStorage.getItem(KEY + '.dating');
  if (dw) dworld.restore(JSON.parse(dw));
} catch { /* start clean */ }

const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ users: [...auth.users], consents: [...auth.consents], current: auth.current, accounts: [...accounts].map(([id, f]) => [id, f.account]) })); } catch { /* ignore */ } };
setInterval(save, 100);
addEventListener('pagehide', save);
const saveWorld = () => { try { localStorage.setItem(KEY + '.world', JSON.stringify(world.snapshot())); } catch { /* ignore */ } };
const saveDating = () => { try { localStorage.setItem(KEY + '.dating', JSON.stringify(dworld.snapshot())); } catch { /* ignore */ } };
setInterval(() => { saveWorld(); saveDating(); syncAccounts(); }, 150);
addEventListener('pagehide', () => { syncAccounts(); saveDating(); });
addEventListener('pagehide', saveWorld);

const make = (u: AuthUser) => {
  let f = accounts.get(u.id);
  if (!f) { f = new FakeAccountApi(u.id, u.email); f.latencyMs = 120; f.account.consent = auth.consents.get((u.email ?? '').toLowerCase()) ?? null; accounts.set(u.id, f); }
  return f;
};

// The account fake is the source of truth for the signed-in person's own dating profile; mirror it into the dating world.
function syncAccounts() {
  accounts.forEach((f, id) => {
    const a = f.account; if (!a.onboarding.completedAt) return;
    const u = world.users.get(id); if (u) { u.name = a.displayName || u.name; u.age = a.age ?? 30; u.visibility = a.socialVisibility; }
    dworld.setDating(id, { gender: a.gender, showGender: a.showGender, showDistance: a.showDistance, interestedIn: a.interestedIn, ageMin: a.ageMin, ageMax: a.ageMax, maxKm: a.maxDistanceKm,
      discoverable: a.datingDiscoverable, place: fakePlaceById(a.place?.id ?? null), intention: a.intention ?? 'long-term', interests: a.interests.map((x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-')), bio: a.bio, pronouns: a.pronouns,
      filterIntentions: a.filterIntentions, filterInterests: a.filterInterests.map((x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-')) });
  });
}
const datings = new Map<string, FakeDatingApi>();
const makeDating = (u: AuthUser) => {
  makeSocial(u); syncAccounts();
  if (!dworld.actions.has(`${DSEED.rita}>${u.id}`)) dworld.actions.set(`${DSEED.rita}>${u.id}`, { action: 'like', at: Date.now() });
  let f = datings.get(u.id); if (!f) { f = new FakeDatingApi(dworld, u.id); f.latencyMs = 120; datings.set(u.id, f); }
  return f;
};
const socials = new Map<string, FakeSocialApi>();
const makeSocial = (u: AuthUser) => {
  if (!world.users.has(u.id)) world.users.set(u.id, { id: u.id, name: accounts.get(u.id)?.account.displayName || 'You', visibility: accounts.get(u.id)?.account.socialVisibility ?? 'public', bio: '', age: 30, completed: true });
  const me = world.users.get(u.id)!; const acct = accounts.get(u.id)?.account;
  if (acct) { me.name = acct.displayName || me.name; me.visibility = acct.socialVisibility; }
  let f = socials.get(u.id);
  if (!f) { f = new FakeSocialApi(world, u.id); f.latencyMs = 120; socials.set(u.id, f); }
  return f;
};

declare global { interface Window { __fake: { auth: FakeAuthApi; accounts: Map<string, FakeAccountApi>; world: FakeSocialWorld; socials: Map<string, FakeSocialApi>; seed: typeof SEED; dworld: FakeDatingWorld; datings: Map<string, FakeDatingApi>; dseed: typeof DSEED } } }
window.__fake = { auth, accounts, world, socials, seed: SEED, dworld, datings, dseed: DSEED };

export function UiTestApp() { return <RealAppView authApi={auth} make={make} makeSocial={makeSocial} makeDating={makeDating} />; }
