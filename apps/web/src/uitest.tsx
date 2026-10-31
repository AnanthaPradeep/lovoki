// DEV/TEST ONLY. Loaded only by `vite --mode uitest`. Drives the real-mode UI with in-memory fakes, persisted
// to localStorage so refresh/resume can be tested. This is NOT Supabase and never ships in a production build.
import { FakeAccountApi, FakeAuthApi, FakeSocialApi, FakeSocialWorld, type AuthUser } from '@lovoki/core';
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

try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const s = JSON.parse(raw) as { users: [string, { id: string; password: string; confirmed: boolean }][]; current: AuthUser | null; accounts: [string, FakeAccountApi['account']][] };
    auth.users = new Map(s.users); auth.current = s.current;
    s.accounts.forEach(([id, a]) => { const f = new FakeAccountApi(id, a.email); f.latencyMs = 120; f.account = a; accounts.set(id, f); });
  }
  const w = localStorage.getItem(KEY + '.world');
  if (w) world.restore(JSON.parse(w));
} catch { /* start clean */ }

const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ users: [...auth.users], current: auth.current, accounts: [...accounts].map(([id, f]) => [id, f.account]) })); } catch { /* ignore */ } };
setInterval(save, 100);
addEventListener('pagehide', save);
const saveWorld = () => { try { localStorage.setItem(KEY + '.world', JSON.stringify(world.snapshot())); } catch { /* ignore */ } };
setInterval(saveWorld, 150);
addEventListener('pagehide', saveWorld);

const make = (u: AuthUser) => {
  let f = accounts.get(u.id);
  if (!f) { f = new FakeAccountApi(u.id, u.email); f.latencyMs = 120; accounts.set(u.id, f); }
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

declare global { interface Window { __fake: { auth: FakeAuthApi; accounts: Map<string, FakeAccountApi>; world: FakeSocialWorld; socials: Map<string, FakeSocialApi>; seed: typeof SEED } } }
window.__fake = { auth, accounts, world, socials, seed: SEED };

export function UiTestApp() { return <RealAppView authApi={auth} make={make} makeSocial={makeSocial} />; }
