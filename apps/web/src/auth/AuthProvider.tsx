import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { mapAuthError, type AuthApi, type AuthUser } from '@lovoki/core';
import { clearUserData } from '../data/userScope';

interface AuthState { status: 'loading' | 'signed-out' | 'signed-in'; user: AuthUser | null; notice: 'expired' | null }
interface AuthCtx { state: AuthState; api: AuthApi; signOut: () => Promise<void>; refresh: () => Promise<void>; dismissNotice: () => void }
const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside <AuthProvider>');
  return c;
}

const same = (a: AuthUser | null, b: AuthUser | null) => a?.id === b?.id && a?.email === b?.email && a?.emailConfirmed === b?.emailConfirmed;

export function AuthProvider({ api, children }: { api: AuthApi; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, notice: null });

  useEffect(() => {
    let alive = true;
    api.getUser()
      .then((u) => { if (alive) setState({ status: u ? 'signed-in' : 'signed-out', user: u, notice: null }); })
      .catch((e) => { if (alive) setState({ status: 'signed-out', user: null, notice: mapAuthError(e).code === 'session_expired' ? 'expired' : null }); });
    const off = api.onChange((u) => {
      if (!alive) return;
      if (!u) clearUserData(); // signed out here, in another tab, or by an expired refresh token
      setState((prev) => {
        if (!u) return { status: 'signed-out', user: null, notice: prev.status === 'signed-in' ? prev.notice : null };
        return prev.status === 'signed-in' && same(prev.user, u) ? prev : { status: 'signed-in', user: u, notice: null };
      });
    });
    return () => { alive = false; off(); };
  }, [api]);

  const signOut = useCallback(async () => {
    clearUserData();
    try { await api.signOut(); } finally { setState({ status: 'signed-out', user: null, notice: null }); }
  }, [api]);
  /** Re-reads the session now (used right after an email-link callback sets one). */
  const refresh = useCallback(async () => {
    const u = await api.getUser();
    setState((prev) => (u ? (prev.status === 'signed-in' && same(prev.user, u) ? prev : { status: 'signed-in', user: u, notice: null }) : { status: 'signed-out', user: null, notice: prev.notice }));
  }, [api]);
  const dismissNotice = useCallback(() => setState((s) => ({ ...s, notice: null })), []);

  const value = useMemo(() => ({ state, api, signOut, refresh, dismissNotice }), [state, api, signOut, refresh, dismissNotice]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
