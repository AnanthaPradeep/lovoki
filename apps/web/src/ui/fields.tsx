import { useCallback, useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes } from 'react';
import { useBlocker } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, ImageOff } from 'lucide-react';
import type { AccountApi } from '@lovoki/core';
import { Dialog } from './index';

interface BaseProps { id: string; label: ReactNode; error?: string; hint?: ReactNode }

export function TextField({ id, label, error, hint, className, ...rest }: BaseProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>) {
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field" data-invalid={!!error}>
      <label htmlFor={id}>{label}</label>
      <input id={id} className={`input ${className ?? ''}`} aria-invalid={!!error} aria-describedby={describedBy} {...rest} />
      {hint && !error && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {error && <div className="field-error" id={`${id}-err`}><AlertCircle size={14} aria-hidden />{error}</div>}
    </div>
  );
}

export function PasswordField({ id, label, error, hint, ...rest }: BaseProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'>) {
  const [shown, setShown] = useState(false);
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field" data-invalid={!!error}>
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input id={id} className="input" type={shown ? 'text' : 'password'} aria-invalid={!!error} aria-describedby={describedBy} autoCapitalize="none" spellCheck={false} {...rest} />
        <button type="button" className="icon-btn pw-toggle" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-label={shown ? 'Hide password' : 'Show password'}>
          {shown ? <EyeOff size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
        </button>
      </div>
      {hint && !error && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {error && <div className="field-error" id={`${id}-err`}><AlertCircle size={14} aria-hidden />{error}</div>}
    </div>
  );
}

/** Blocks double submits immediately (a ref, not state, so two fast clicks cannot both pass). */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await fn(); } finally { lock.current = false; setBusy(false); }
  }, []);
  return { busy, run };
}

const remaining = (key: string) => { try { return Math.max(0, Math.ceil((Number(sessionStorage.getItem(key) ?? 0) - Date.now()) / 1000)); } catch { return 0; } };

/** Countdown that survives a refresh (stored as an absolute end time). */
export function useCooldown(key: string, seconds: number) {
  const [left, setLeft] = useState(() => remaining(key));
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(remaining(key)), 1000);
    return () => clearTimeout(t);
  }, [left, key]);
  const start = useCallback(() => {
    try { sessionStorage.setItem(key, String(Date.now() + seconds * 1000)); } catch { /* ignore */ }
    setLeft(seconds);
  }, [key, seconds]);
  return { left, start };
}

export function focusFirstInvalid() {
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

/** Warns on refresh/close and on in-app navigation while there are unsaved edits. */
export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  return (
    <Dialog open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} title="Discard your changes?"
      footer={<><button type="button" className="btn btn-secondary" onClick={() => blocker.reset?.()}>Keep editing</button>
        <button type="button" className="btn btn-danger" onClick={() => blocker.proceed?.()}>Discard changes</button></>}>
      <p className="muted">You have edits that haven’t been saved. If you leave now they’ll be lost.</p>
    </Dialog>
  );
}

/** A private photo, fetched through a short-lived authorized URL. Fixed aspect ratio so layout never jumps. */
export function SignedPhoto({ path, alt, api, className = 'ratio-45' }: { path: string; alt: string; api: AccountApi; className?: string }) {
  const [st, setSt] = useState<{ url?: string; failed?: boolean; imgFailed?: boolean }>({});
  useEffect(() => {
    let alive = true;
    setSt({});
    api.photoUrl(path).then((url) => { if (alive) setSt({ url }); }).catch(() => { if (alive) setSt({ failed: true }); });
    return () => { alive = false; };
  }, [api, path]);
  if (st.failed || st.imgFailed) {
    return <div className={`photo ${className}`} role="img" aria-label={`${alt} (unavailable)`}><div className="photo-fallback"><ImageOff size={24} aria-hidden /><span>Photo unavailable</span></div></div>;
  }
  if (!st.url) return <div className={`photo ${className} skeleton`} aria-busy="true" />;
  return <div className={`photo ${className}`}><img src={st.url} alt={alt} draggable={false} onError={() => setSt((s) => ({ ...s, imgFailed: true }))} /></div>;
}
