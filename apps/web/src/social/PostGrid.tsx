import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ImageOff, LayoutGrid, Play } from 'lucide-react';
import type { MediaRef, PostView } from '@lovoki/core';
import { EmptyState } from '../ui';
import { blurhashDataUrl } from '../data/blurhash';
import { LoadError, LoadMore } from './parts';
import { useMediaUrls } from './SocialProvider';
import type { usePostList } from './usePagedList';

/** True from 768px up, where a post opens in a dialog with its own URL. Below that it is a full page. */
export function useIsDesktop() {
  const q = '(min-width: 768px)';
  const [wide, setWide] = useState(() => (typeof matchMedia === 'function' ? matchMedia(q).matches : true));
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(q); const on = () => setWide(m.matches);
    m.addEventListener('change', on); on();
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

const excerpt = (s: string) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > 60 ? `${t.slice(0, 57)}…` : t; };

function Tile({ post, url, settled, to, state }: { post: PostView; url: string | undefined; settled: boolean; to: string; state: unknown }) {
  const [broken, setBroken] = useState(false);
  const m = post.media;
  const blur = blurhashDataUrl(m?.blurhash);
  const label = `Open post${post.caption ? `: ${excerpt(post.caption)}` : ''}${post.isSample ? ' (sample)' : ''}`;
  return (
    <Link to={to} state={state} className="pgrid-tile" aria-label={label} data-post-id={post.id}
      style={blur ? { backgroundImage: `url(${blur})`, backgroundSize: 'cover' } : undefined}>
      {m ? (broken || (settled && !url)
        ? <span className="tile-text"><ImageOff size={20} aria-hidden /></span>
        : url ? <img src={url} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} /> : <span className={blur ? '' : 'skeleton'} style={{ position: 'absolute', inset: 0 }} aria-hidden />)
        : <span className="tile-text">{post.caption}</span>}
      {m?.kind === 'video' && <Play size={18} className="tile-mark" aria-hidden />}
    </Link>
  );
}

/**
 * The 3-column square grid. Tiles keep their shape while loading, and use the ~400 px thumbnail (never the original).
 * Each tile opens /p/:id: in a dialog with prev/next on desktop, as a full page on a phone.
 */
export function PostGrid({ list, empty, hideSamples = false }: { list: ReturnType<typeof usePostList>; empty: { title: string; body: ReactNode; action?: ReactNode }; hideSamples?: boolean }) {
  const loc = useLocation();
  const desktop = useIsDesktop();
  const items = useMemo(() => list.state.items.filter((p) => !(hideSamples && p.isSample)), [list.state.items, hideSamples]);
  const refs = useMemo<MediaRef[]>(() => items.flatMap((p) => (p.media ? [{ bucket: 'post-media' as const, path: p.media.thumbPath ?? p.media.path }] : [])), [items]);
  const { urls, settled } = useMediaUrls(refs);
  const ids = useMemo(() => items.map((p) => p.id), [items]);

  if (list.status === 'loading') return <div className="pgrid" aria-busy="true" aria-label="Loading posts">{Array.from({ length: 9 }, (_, i) => <div key={i} className="pgrid-tile skeleton" aria-hidden />)}</div>;
  if (list.status === 'error') return <LoadError message={list.error ?? 'Couldn’t load posts.'} onRetry={list.reload} />;
  if (!items.length) return <EmptyState icon={<LayoutGrid size={28} />} title={empty.title} body={empty.body} action={empty.action} />;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="pgrid" role="list" aria-label="Posts">
        {items.map((p, i) => (
          <div role="listitem" key={p.id} style={{ display: 'contents' }}>
            <Tile post={p} url={p.media ? urls.get(p.media.thumbPath ?? p.media.path) : undefined} settled={settled} to={`/p/${p.id}`} state={{ background: desktop ? loc : undefined, ids, index: i }} />
          </div>
        ))}
      </div>
      <LoadMore visible={!!list.state.next} state={list.more} error={list.error} onMore={list.loadMore} />
    </div>
  );
}
