import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell, LayoutGrid } from 'lucide-react';
import type { MediaRef } from '@lovoki/core';
import { EmptyState } from '../ui';
import { PostCard } from './PostCard';
import { LoadError, LoadMore, PostSkeletons } from './parts';
import { useMediaUrls, useSocial } from './SocialProvider';
import type { usePostList } from './usePagedList';

/** Renders one keyset-paged list of posts with every state: loading, error + retry, empty, items, load more. */
export function PostList({ list, empty }: { list: ReturnType<typeof usePostList>; empty: { title: string; body: ReactNode; action?: ReactNode } }) {
  const refs = useMemo<MediaRef[]>(() => list.state.items.flatMap((p) => [
    ...(p.media ? [{ bucket: 'post-media' as const, path: p.media.path }] : []),
    ...(p.authorPhotoPath ? [{ bucket: 'profile-photos' as const, path: p.authorPhotoPath }] : []),
  ]), [list.state.items]);
  const { urls, settled } = useMediaUrls(refs);

  if (list.status === 'loading') return <PostSkeletons />;
  if (list.status === 'error') return <LoadError message={list.error ?? 'Couldn’t load posts.'} onRetry={list.reload} />;
  if (!list.state.items.length) return <EmptyState icon={<LayoutGrid size={28} />} title={empty.title} body={empty.body} action={empty.action} />;
  return (
    <div className="stack" style={{ gap: 24 }}>
      {list.state.items.map((p) => <PostCard key={p.id} post={p} dispatch={list.dispatch} urls={urls} settled={settled} />)}
      <LoadMore visible={!!list.state.next} state={list.more} error={list.error} onMore={list.loadMore} />
    </div>
  );
}

/** Bell with the unread count. Refreshes through SocialProvider on focus and navigation. */
export function NotificationsLink() {
  const { unread } = useSocial();
  return (
    <Link to="/notifications" className="icon-btn bell" aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} style={{ position: 'relative' }}>
      <Bell size={22} aria-hidden />
      {unread > 0 && <span className="badge" style={{ position: 'absolute', top: 2, right: 0 }} aria-hidden>{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}
