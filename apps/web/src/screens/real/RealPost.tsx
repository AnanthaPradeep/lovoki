import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileX } from 'lucide-react';
import { SocialFailure, emptyList, postsReducer, type PostView } from '@lovoki/core';
import { EmptyState } from '../../ui';
import { useTitle } from '../../ui/useTitle';
import { PostCard } from '../../social/PostCard';
import { LoadError, PostSkeletons } from '../../social/parts';
import { useMediaUrls, useSocial } from '../../social/SocialProvider';

/** One post, opened from a notification. A post you can't see and a post that doesn't exist look the same. */
export function RealPost() {
  useTitle('Post');
  const { id = '' } = useParams();
  const { api } = useSocial();
  const [state, dispatch] = useReducer(postsReducer, undefined, emptyList<PostView>);
  const [st, setSt] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    setSt('loading');
    api.post(id).then((p) => { if (!p) { setSt('missing'); return; } dispatch({ type: 'replace', page: { items: [p], next: null } }); setSt('ready'); })
      .catch((e) => { setMsg(e instanceof SocialFailure ? e.message : 'Couldn’t load this post.'); setSt('error'); });
  }, [api, id]);
  useEffect(() => { load(); }, [load]);
  const post = state.items[0];
  const refs = useMemo(() => (post ? [
    ...(post.media ? [{ bucket: 'post-media' as const, path: post.media.path }] : []), ...(post.authorPhotoPath ? [{ bucket: 'profile-photos' as const, path: post.authorPhotoPath }] : [])] : []), [post]);
  const { urls, settled } = useMediaUrls(refs);
  return (
    <div className="page stack" style={{ gap: 16 }}>
      <Link to="/notifications" className="back"><ArrowLeft size={18} aria-hidden />Notifications</Link>
      {st === 'loading' && <PostSkeletons count={1} />}
      {st === 'error' && <LoadError message={msg} onRetry={load} />}
      {st === 'missing' && <EmptyState icon={<FileX size={28} />} title="This post isn’t available" body="It may have been deleted, or you may no longer be able to see it." action={<Link to="/feed" className="btn btn-primary">Back to the feed</Link>} />}
      {st === 'ready' && post && <PostCard post={post} dispatch={dispatch} urls={urls} settled={settled} />}
      {st === 'ready' && !post && <EmptyState icon={<FileX size={28} />} title="This post was deleted" body="It’s gone for everyone." />}
    </div>
  );
}
