import { useEffect, useSyncExternalStore } from 'react';
import type { ThemePreference } from '@lovoki/core';

/** Theme preference for real mode. A UI preference, not user data, so it survives logout. */
const KEY = 'lovoki.ui.theme';
const read = (): ThemePreference => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; } };
let current = read();
const listeners = new Set<() => void>();
export const themeStore = {
  get: () => current,
  set(t: ThemePreference) { current = t; try { localStorage.setItem(KEY, t); } catch { /* ignore */ } listeners.forEach((l) => l()); },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
export const useThemePref = () => useSyncExternalStore(themeStore.subscribe, themeStore.get);

export function useApplyTheme(pref: ThemePreference) {
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', pref);
    const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1C0E19' : '#FFF3E6');
  }, [pref]);
}
