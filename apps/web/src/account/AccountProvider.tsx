import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccountFailure, withRetry, type Account, type AccountApi, type AuthUser } from '@lovoki/core';
import { useAuth } from '../auth/AuthProvider';

interface Inner { status: 'idle' | 'loading' | 'ready' | 'error'; account: Account | null; error: AccountFailure | null }
interface AccountCtx extends Inner { api: AccountApi | null; reload: () => Promise<Account>; retry: () => void }
const Ctx = createContext<AccountCtx | null>(null);

export function useAccount(): AccountCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAccount must be used inside <AccountProvider>');
  return c;
}
/** For screens that only render when an account is loaded (behind the route gate). */
export function useReadyAccount(): { account: Account; api: AccountApi; reload: () => Promise<Account> } {
  const { account, api, reload } = useAccount();
  if (!account || !api) throw new Error('Account is not loaded');
  return { account, api, reload };
}

const toFailure = (e: unknown) => (e instanceof AccountFailure ? e : new AccountFailure('unknown', 'Your profile couldn’t be loaded. Try again.'));

export function AccountProvider({ make, children }: { make: (user: AuthUser) => AccountApi; children: ReactNode }) {
  const { state } = useAuth();
  const api = useMemo(() => (state.user ? make(state.user) : null), [state.user, make]);
  const [s, setS] = useState<Inner>({ status: 'idle', account: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!api) { setS({ status: 'idle', account: null, error: null }); return; }
    let alive = true;
    setS((p) => ({ status: 'loading', account: p.account, error: null }));
    withRetry(() => api.load())
      .then((a) => { if (alive) setS({ status: 'ready', account: a, error: null }); })
      .catch((e) => { if (alive) setS({ status: 'error', account: null, error: toFailure(e) }); });
    return () => { alive = false; };
  }, [api, attempt]);

  const reload = useCallback(async () => {
    if (!api) throw new AccountFailure('unauthorized', 'You’re signed out.');
    const a = await withRetry(() => api.load());
    setS({ status: 'ready', account: a, error: null });
    return a;
  }, [api]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo(() => ({ ...s, api, reload, retry }), [s, api, reload, retry]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
