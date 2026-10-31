import { useState, type ReactNode } from 'react';
import { AlertCircle, ImageOff, Loader2, Lock } from 'lucide-react';
import type { AvatarCrop } from '@lovoki/core';
import { Notice } from '../ui';
import { blurhashDataUrl } from '../data/blurhash';

/** Sample content is always labelled. Fictional, and it reaches no real person. */
export function SampleBadge({ className = '' }: { className?: string }) {
  return <span className={`badge-sample ${className}`} title="Sample content: fictional, for testing. It reaches no real person.">Sample</span>;
}
/** A private account. The text is for screen readers; sighted users get the lock. */
export function LockMark({ size = 14 }: { size?: number }) {
  return <span className="lock-mark" title="Private account"><Lock size={size} aria-hidden /><span className="sr-only">Private account</span></span>;
}

/** A private image at a fixed aspect ratio, so layout never jumps while it loads or if it fails. */
export function SocialImage({ url, settled, alt, className = 'ratio-45', blurhash }: { url: string | undefined; settled: boolean; alt: string; className?: string; blurhash?: string | null }) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const blur = blurhashDataUrl(blurhash);
  if (broken || (settled && !url)) {
    return <div className={`photo ${className}`} role="img" aria-label={`${alt} (unavailable)`}><div className="photo-fallback"><ImageOff size={24} aria-hidden /><span>Photo unavailable</span></div></div>;
  }
  if (!url) return <div className={`photo ${className} ${blur ? '' : 'skeleton'}`} aria-busy="true" style={blur ? { backgroundImage: `url(${blur})`, backgroundSize: 'cover' } : undefined} />;
  return (
    <div className={`photo ${className}`} style={blur ? { backgroundImage: `url(${blur})`, backgroundSize: 'cover' } : undefined}>
      <img src={url} alt={alt} draggable={false} loading="lazy" className={`fade-in ${loaded ? 'is-in' : ''}`} onLoad={() => setLoaded(true)} onError={() => setBroken(true)} />
    </div>
  );
}

/** CSS for a square crop of a photo: the centre and zoom the owner chose. */
export const cropStyle = (c: AvatarCrop | null | undefined): React.CSSProperties =>
  c ? { objectFit: 'cover', objectPosition: `${c.x * 100}% ${c.y * 100}%`, transform: `scale(${c.zoom})`, transformOrigin: `${c.x * 100}% ${c.y * 100}%` } : { objectFit: 'cover' };

const initials = (name: string) => [...name.trim()].slice(0, 1).join('').toUpperCase() || '?';

/** Round avatar: the person's main photo when it can be shown, otherwise their initial. Never a stranger's face. */
export function PersonAvatar({ name, url, size = 40, crop, blurhash, locked = false }: { name: string; url?: string; size?: number; crop?: AvatarCrop | null; blurhash?: string | null; locked?: boolean }) {
  const [broken, setBroken] = useState(false);
  const blur = blurhashDataUrl(blurhash);
  const showImg = url && !broken;
  // No real picture for this viewer: a blurred stand-in (decoded from a ~30 character hash, never the file) or the initial.
  return (
    <div className={`avatar ${!showImg && blur ? 'avatar-blur' : ''}`} data-blurred={!showImg && !!blur ? 'true' : undefined}
      style={{ width: size, height: size, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: size * 0.4, position: 'relative', overflow: 'hidden', flex: 'none' }} aria-hidden>
      {showImg ? <img src={url} alt="" draggable={false} style={{ width: '100%', height: '100%', ...cropStyle(crop) }} onError={() => setBroken(true)} />
        : blur ? <img src={blur} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(6px)', transform: 'scale(1.3)' }} /> : <span>{initials(name)}</span>}
      {locked && !showImg && <span className="avatar-lock"><Lock size={Math.max(12, size * 0.28)} aria-hidden /></span>}
    </div>
  );
}

export function PostSkeletons({ count = 2 }: { count?: number }) {
  return (
    <div className="stack" style={{ gap: 24 }} aria-busy="true" aria-label="Loading posts">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card" aria-hidden>
          <div className="row" style={{ padding: 16, gap: 12 }}><div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%' }} /><div className="skeleton" style={{ height: 16, width: 140 }} /></div>
          <div className="skeleton" style={{ aspectRatio: '4 / 5', borderRadius: 0 }} />
          <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 14, width: '70%' }} /></div>
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card card-pad stack" aria-busy="true" aria-label="Loading" style={{ gap: 14 }}>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="row" style={{ gap: 12 }} aria-hidden><div className="skeleton" style={{ width: 48, height: 48, borderRadius: '50%' }} /><div className="skeleton" style={{ height: 16, flex: 1 }} /></div>)}
    </div>
  );
}

/** Initial-load failure: says what happened and offers a retry. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <Notice tone="error" action={<button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>Try again</button>}>{message}</Notice>;
}

/** "Load more" with its own busy and error states, so a failed page never wipes the list. */
export function LoadMore({ visible, state, error, onMore }: { visible: boolean; state: 'idle' | 'loading' | 'error' | 'ready'; error: string | null; onMore: () => void }) {
  if (!visible && state !== 'error') return null;
  return (
    <div className="stack" style={{ gap: 8, justifyItems: 'center', marginTop: 8 }}>
      {state === 'error' && error && <p className="field-error" role="alert"><AlertCircle size={14} aria-hidden />{error}</p>}
      <button type="button" className="btn btn-secondary" onClick={onMore} disabled={state === 'loading'} aria-busy={state === 'loading'}>
        {state === 'loading' ? <><Loader2 size={16} className="spin" aria-hidden />Loading…</> : state === 'error' ? 'Try again' : 'Load more'}
      </button>
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="stack" style={{ gap: 12 }} aria-label={title}><div className="row"><h2 className="grow" style={{ fontSize: 'var(--fs-title)' }}>{title}</h2>{action}</div>{children}</section>;
}
