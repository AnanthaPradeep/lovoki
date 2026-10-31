import { useCallback, useEffect, useRef, useState } from 'react';

/** The public Turnstile SITE key. Absent = no widget and nothing is required. Present = sign-up and password reset need a solved check. */
export const CAPTCHA_SITE_KEY: string = (import.meta.env.VITE_CAPTCHA_SITE_KEY as string | undefined)?.trim() ?? '';
const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface Turnstile { render(el: HTMLElement, o: { sitekey: string; callback: (t: string) => void; 'expired-callback': () => void; 'error-callback': () => void; theme?: string }): string; reset(id?: string): void; remove(id?: string): void }
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script'); s.src = SRC; s.async = true; s.defer = true;
    s.onload = () => resolve(); s.onerror = () => { loading = null; reject(new Error('captcha script failed')); };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Returns the widget element to render, whether a check is required, the current token, and a reset for after a failed submit.
 * The token is single-use: reset after every attempt.
 */
export function useCaptcha() {
  const enabled = CAPTCHA_SITE_KEY !== '';
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || !host.current) return;
    let alive = true; const el = host.current;
    loadScript().then(() => {
      if (!alive || !window.turnstile || widget.current) return;
      widget.current = window.turnstile.render(el, { sitekey: CAPTCHA_SITE_KEY, callback: (t) => setToken(t), 'expired-callback': () => setToken(null), 'error-callback': () => { setToken(null); setFailed(true); },
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'auto' });
    }).catch(() => setFailed(true));
    return () => { alive = false; if (widget.current && window.turnstile) { window.turnstile.remove(widget.current); widget.current = null; } };
  }, [enabled]);

  const reset = useCallback(() => { setToken(null); if (widget.current && window.turnstile) window.turnstile.reset(widget.current); }, []);
  const element = enabled ? (
    <div className="field" data-testid="captcha">
      <div ref={host} style={{ minHeight: 65 }} aria-label="Security check" />
      {failed && <p className="field-error" role="alert">The security check couldn’t load. Check your connection, disable blockers for this site, and reload.</p>}
    </div>
  ) : null;
  return { enabled, token, element, reset, failed };
}
