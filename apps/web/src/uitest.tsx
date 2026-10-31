// DEV/TEST ONLY. Loaded only by `vite --mode uitest`. Drives the real-mode UI with in-memory fakes, persisted
// to localStorage so refresh/resume can be tested. This is NOT Supabase and never ships in a production build.
import { FakeAccountApi, FakeAuthApi, type AuthUser } from '@lovoki/core';
import { RealAppView } from './RealApp';

const KEY = 'lovoki.uitest.state';
const auth = new FakeAuthApi();
auth.latencyMs = 200; // realistic enough that in-flight states (and the duplicate-submit guard) are observable
const accounts = new Map<string, FakeAccountApi>();

try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const s = JSON.parse(raw) as { users: [string, { id: string; password: string; confirmed: boolean }][]; current: AuthUser | null; accounts: [string, FakeAccountApi['account']][] };
    auth.users = new Map(s.users); auth.current = s.current;
    s.accounts.forEach(([id, a]) => { const f = new FakeAccountApi(id, a.email); f.latencyMs = 120; f.account = a; accounts.set(id, f); });
  }
} catch { /* start clean */ }

const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ users: [...auth.users], current: auth.current, accounts: [...accounts].map(([id, f]) => [id, f.account]) })); } catch { /* ignore */ } };
setInterval(save, 100);
addEventListener('pagehide', save);

const make = (u: AuthUser) => {
  let f = accounts.get(u.id);
  if (!f) { f = new FakeAccountApi(u.id, u.email); f.latencyMs = 120; accounts.set(u.id, f); }
  return f;
};

declare global { interface Window { __fake: { auth: FakeAuthApi; accounts: Map<string, FakeAccountApi> } } }
window.__fake = { auth, accounts };

export function UiTestApp() { return <RealAppView authApi={auth} make={make} />; }
