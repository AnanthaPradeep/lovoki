import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, FileX } from 'lucide-react';
import { SocialFailure, emptyList, postsReducer, type PostView } from '@lovoki/core';
import { Dialog, EmptyState } from '../../ui';
import { useTitle } from '../../ui/useTitle';
import { PostCard } from '../../social/PostCard';
import { LoadError, PostSkeletons } from '../../social/parts';
import { useMediaUrls, useSocial } from '../../social/SocialProvider';

interface NavState { background?: unknown; ids?: string[]; index?: number }

/** Previous and next post among the ids the grid passed along. Keys: left and right arrows (never while typing). */
function useSiblings(id: string, replace: boolean) {
  const nav = useNavigate();
  const loc = useLocation();
  const st = useMemo(() => (loc.state ?? {}) as NavState, [loc.state]);
  const ids = st.ids ?? [];
  const at = ids.indexOf(id);
  const prev = at > 0 ? ids[at - 1]! : null;
  const next = at >= 0 && at < ids.length - 1 ? ids[at + 1]! : null;
  const go = useCallback((to: string | null, i: number) => { if (to) nav(`/p/${to}`, { replace, state: { ...st, index: i } }); }, [nav, replace, st]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft' && prev) { e.preventDefault(); go(prev, at - 1); }
      if (e.key === 'ArrowRight' && next) { e.preventDefault(); go(next, at + 1); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, at, go]);
  return { prev, next, at, count: ids.length, goPrev: () => go(prev, at - 1), goNext: () => go(next, at + 1) };
}

/** One post, loaded by id. A post you can't see and a post that doesn't exist look the same. */
export function PostViewer({ id, replace }: { id: string; replace: boolean }) {
  const { api } = useSocial();
  const [state, dispatch] = useReducer(postsReducer, undefined, emptyList<PostView>);
  const [st, setSt] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [msg, setMsg] = useState('');
  const sib = useSiblings(id, replace);
  const load = useCallback(() => {
    setSt('loading');
    api.post(id).then((p) => { if (!p) { setSt('missing'); return; } dispatch({ type: 'replace', page: { items: [p], next: null } }); setSt('ready'); })
      .catch((e) => { setMsg(e instanceof SocialFailure ? e.message : 'Couldn’t load this post.'); setSt('error'); });
  }, [api, id]);
  useEffect(() => { load(); }, [load]);
  const post = state.items[0];
  useTitle(post ? `${post.authorName} on LOVOKI` : 'Post');
  const refs = useMemo(() => (post ? [
    ...(post.media ? [{ bucket: 'post-media' as const, path: post.media.path }] : []), ...(post.authorPhotoPath ? [{ bucket: 'profile-photos' as const, path: post.authorPhotoPath }] : [])] : []), [post]);
  const { urls, settled } = useMediaUrls(refs);
  return (
    <div className="post-modal" data-testid="post-viewer">
      {sib.count > 1 && (
        <div className="post-nav">
          <button type="button" className="btn btn-secondary btn-sm" onClick={sib.goPrev} disabled={!sib.prev} aria-label="Previous post"><ChevronLeft size={16} aria-hidden />Previous</button>
          <span className="subtle" aria-live="polite">{sib.at + 1} of {sib.count}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={sib.goNext} disabled={!sib.next} aria-label="Next post">Next<ChevronRight size={16} aria-hidden /></button>
        </div>
      )}
      {st === 'loading' && <PostSkeletons count={1} />}
      {st === 'error' && <LoadError message={msg} onRetry={load} />}
      {st === 'missing' && <EmptyState icon={<FileX size={28} />} title="This post isn’t available" body="It may have been deleted, or you may no longer be able to see it." action={<Link to="/feed" className="btn btn-primary">Back to the feed</Link>} />}
      {st === 'ready' && post && <PostCard key={post.id} post={post} dispatch={dispatch} urls={urls} settled={settled} />}
      {st === 'ready' && !post && <EmptyState icon={<FileX size={28} />} title="This post was deleted" body="It’s gone for everyone." />}
    </div>
  );
}

/** /p/:id as a page: phones, direct links and notification links. */
export function RealPost() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const hasHistory = ((loc.state ?? {}) as NavState).ids !== undefined;
  return (
    <div className="page stack" style={{ gap: 16 }}>
      {hasHistory
        ? <button type="button" className="back" onClick={() => nav(-1)}><ArrowLeft size={18} aria-hidden />Back</button>
        : <Link to="/notifications" className="back"><ArrowLeft size={18} aria-hidden />Notifications</Link>}
      <PostViewer id={id} replace={hasHistory} />
    </div>
  );
}

/** /p/:id over the page it was opened from, with its own URL. Esc and the close button return to that page. */
export function RealPostModal() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  return <Dialog open onClose={() => nav(-1)} title="Post"><PostViewer id={id} replace /></Dialog>;
}
