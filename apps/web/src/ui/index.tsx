import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ImageOff, Info, X, CheckCircle2, TriangleAlert } from 'lucide-react';
import { photoDataUri, type Photo as PhotoT, type Profile } from '@lovoki/core';

/* ---------- Photo with loading + broken-image fallback ---------- */
export function Photo({ photo, className = '', sizes }: { photo: PhotoT | undefined; className?: string; sizes?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo?.id]);
  if (!photo || failed) {
    return (
      <div className={`photo ${className}`} role="img" aria-label={photo ? `${photo.alt} (unavailable)` : 'No photo'}>
        <div className="photo-fallback"><ImageOff size={24} aria-hidden /><span>{photo ? 'Photo unavailable' : 'No photo yet'}</span></div>
      </div>
    );
  }
  const src = photo.kind === 'generated' ? photoDataUri(photo.seed) : photo.uri;
  return <div className={`photo ${className}`}><img src={src} alt={photo.alt} sizes={sizes} draggable={false} onError={() => setFailed(true)} loading="lazy" /></div>;
}

/** First photo that is likely to load, so avatars do not show the broken one. */
export const primaryPhoto = (p: Profile) => p.photos.find((ph) => ph.kind === 'generated') ?? p.photos[0];

export function Avatar({ profile, size = 40 }: { profile: Profile; size?: number }) {
  return <div className="avatar" style={{ width: size, height: size }}><Photo photo={primaryPhoto(profile)} /></div>;
}

/* ---------- Dialog (native <dialog>: focus trap + Esc for free) ---------- */
export function Dialog({ open, onClose, title, children, footer, labelledBy }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dlg" aria-labelledby={labelledBy ?? id} onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="dlg-inner">
          <div className="dlg-head"><h2 id={id}>{title}</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
          <div className="dlg-body">{children}</div>
          {footer && <div className="dlg-foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel, danger = true }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; body: ReactNode; confirmLabel: string; danger?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button></>}>
      <div className="muted">{body}</div>
    </Dialog>
  );
}

/* ---------- Menu ---------- */
export function Menu({ label, icon, items }: { label: string; icon: ReactNode; items: { label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    wrap.current?.querySelector<HTMLButtonElement>('.menu button')?.focus();
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={wrap}>
      <button type="button" className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{icon}</button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it) => (
            <button type="button" key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { setOpen(false); it.onSelect(); }}>{it.icon}{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Toasts ---------- */
interface Toast { id: number; text: string; tone?: 'error'; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.action ? 8000 : 3600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`}>
            <span className="grow">{t.text}</span>
            {t.action && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { t.action!.run(); setToasts((ts) => ts.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Feedback ---------- */
export function Notice({ tone = 'info', children, action }: { tone?: 'info' | 'warning' | 'error' | 'success'; children: ReactNode; action?: ReactNode }) {
  const Icon = { info: Info, warning: TriangleAlert, error: AlertCircle, success: CheckCircle2 }[tone];
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : undefined}><Icon size={18} aria-hidden /><div className="grow">{children}</div>{action}</div>;
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return <div className="empty"><div className="icon-wrap" aria-hidden>{icon}</div><h2>{title}</h2><p>{body}</p>{action}</div>;
}

export const Spinner = ({ label = 'Loading' }: { label?: string }) => <span className="spinner" role="status" aria-label={label} />;

export function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return <div className="field-error" id={id}><AlertCircle size={14} aria-hidden />{children}</div>;
}

export function Counter({ value, max }: { value: number; max: number }) {
  return <div className="counter" data-over={value > max} aria-live="polite">{value}/{max}</div>;
}
