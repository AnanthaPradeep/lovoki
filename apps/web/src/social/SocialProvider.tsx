import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { AuthUser, MediaRef, SocialApi } from '@lovoki/core';
import { useAuth } from '../auth/AuthProvider';

interface SocialCtx { api: SocialApi; userId: string; unread: number; refreshUnread: () => void; setUnread: (n: number) => void }
const Ctx = createContext<SocialCtx | null>(null);

export function useSocial(): SocialCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSocial must be used inside <SocialProvider>');
  return c;
}

/** For shells that also render for signed-out visitors (for example the not-found page): null when no one is signed in. */
export const useSocialOptional = () => useContext(Ctx);

/**
 * Owns the SocialApi for the signed-in user and the unread-notification count.
 * The count refreshes on mount, when the tab regains focus or becomes visible, and on every navigation.
 * (Realtime delivery is Phase 5, so there is deliberately no subscription here.)
 */
export function SocialProvider({ make, children }: { make: (user: AuthUser) => SocialApi; children: ReactNode }) {
  const { state } = useAuth();
  const user = state.user;
  const api = useMemo(() => (user ? make(user) : null), [user, make]);
  const [unread, setUnread] = useState(0);
  const loc = useLocation();

  const refreshUnread = useCallback(() => {
    if (!api) return;
    api.unreadCount().then(setUnread).catch(() => { /* keep the last known value; a badge must never break the app */ });
  }, [api]);

  useEffect(() => { if (!api) setUnread(0); }, [api]);
  useEffect(() => { refreshUnread(); }, [refreshUnread, loc.pathname]);
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') refreshUnread(); };
    window.addEventListener('focus', on); document.addEventListener('visibilitychange', on);
    return () => { window.removeEventListener('focus', on); document.removeEventListener('visibilitychange', on); };
  }, [refreshUnread]);

  const value = useMemo(() => (api && user ? { api, userId: user.id, unread, refreshUnread, setUnread } : null), [api, user, unread, refreshUnread]);
  if (!value) return <>{children}</>; // signed out: the route gate shows auth screens, which never call useSocial
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Resolves private image URLs for a set of refs in ONE batched call per change.
 * `settled` flips when the request finished, so a missing URL can be told apart from "still loading".
 */
export function useMediaUrls(refs: MediaRef[]): { urls: Map<string, string>; settled: boolean } {
  const { api } = useSocial();
  const key = refs.map((r) => `${r.bucket}:${r.path}`).sort().join('|');
  const [res, setRes] = useState<{ key: string; urls: Map<string, string> }>({ key: '', urls: new Map() });
  useEffect(() => {
    if (!refs.length) return;
    let alive = true;
    api.mediaUrls(refs)
      .then((m) => { if (alive) setRes((prev) => ({ key, urls: new Map([...prev.urls, ...m]) })); })
      .catch(() => { if (alive) setRes((prev) => ({ key, urls: prev.urls })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the stable identity of `refs`
  }, [api, key]);
  return { urls: res.urls, settled: !refs.length || res.key === key };
}
