import { useEffect, useState } from 'react';

/** Developer-only tools. Off unless VITE_SHOW_DEV_TOOLS=true at build or start time; never shown in a normal build. */
export const SHOW_DEV_TOOLS = import.meta.env.VITE_SHOW_DEV_TOOLS === 'true';

const KEY = 'lovoki.dev.hideSamples';
const EVENT = 'lovoki:dev-hide-samples';
const read = () => { try { return SHOW_DEV_TOOLS && localStorage.getItem(KEY) === '1'; } catch { return false; } };

export const setHideSamples = (on: boolean) => {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVENT));
};

/** True when a developer chose to hide sample content on this device. Always false without VITE_SHOW_DEV_TOOLS. */
export function useHideSamples(): boolean {
  const [v, setV] = useState(read);
  useEffect(() => { const on = () => setV(read()); window.addEventListener(EVENT, on); window.addEventListener('storage', on); return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); }; }, []);
  return v;
}
