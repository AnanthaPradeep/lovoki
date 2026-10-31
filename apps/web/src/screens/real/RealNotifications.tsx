import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { SocialFailure, notificationText, postedAgo, type NotificationView } from '@lovoki/core';
import { EmptyState, useToast } from '../../ui';
import { useTitle } from '../../ui/useTitle';
import { useSocial } from '../../social/SocialProvider';
import { usePageList } from '../../social/usePagedList';
import { ListSkeleton, LoadError, LoadMore } from '../../social/parts';

type Row = NotificationView & { id: string };

export function RealNotifications() {
  useTitle('Notifications');
  const { api, refreshUnread } = useSocial();
  const toast = useToast();
  const list = usePageList<Row>((c) => api.notifications(c), 'notifications');
  const [busy, setBusy] = useState<string | null>(null);
  // Rows that were unread when the screen opened keep their "new" styling for this visit, even after they are marked read.
  const [wasUnread, setWasUnread] = useState<Set<string>>(new Set());
  const marked = useRef(new Set<string>());

  useEffect(() => {
    if (list.status !== 'ready') return;
    const fresh = list.items.filter((n) => !n.read && !marked.current.has(n.id));
    fresh.forEach((n) => marked.current.add(n.id));
    setWasUnread((prev) => new Set([...prev, ...fresh.map((n) => n.id)]));
    if (!fresh.length) return;
    api.markRead(fresh.map((n) => n.id)).then(refreshUnread).catch(() => { fresh.forEach((n) => marked.current.delete(n.id)); });
  }, [list.items, list.status, api, refreshUnread]);

  const respond = async (n: Row, accept: boolean) => {
    if (busy) return;
    setBusy(n.id);
    try {
      await api.respondToRequest(n.actorId, accept);
      list.setItems((cur) => (accept ? cur.map((x) => (x.id === n.id ? { ...x, followStatus: 'accepted' as const } : x)) : cur.filter((x) => x.id !== n.id)));
      toast({ text: accept ? `${n.actorName} can now see your posts.` : 'Request declined.' });
    } catch (e) { toast({ text: e instanceof SocialFailure ? e.message : 'That didn’t work. Try again.', tone: 'error' }); }
    finally { setBusy(null); }
  };

  const markAll = async () => {
    try { await api.markRead(); list.setItems((cur) => cur.map((n) => ({ ...n, read: true }))); refreshUnread(); }
    catch { toast({ text: 'Couldn’t mark them as read.', tone: 'error' }); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Notifications</h1><p className="sub">Likes, comments and follows. Updated when you open the app or come back to this tab.</p></div>
        {list.items.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => void markAll()}><CheckCheck size={18} aria-hidden />Mark all read</button>}
      </div>
      {list.status === 'loading' && <ListSkeleton />}
      {list.status === 'error' && <LoadError message={list.error ?? 'Couldn’t load notifications.'} onRetry={list.reload} />}
      {list.status === 'ready' && !list.items.length && <EmptyState icon={<Bell size={28} />} title="Nothing yet" body="When someone likes or comments on your posts, or follows you, you’ll see it here." action={<Link to="/feed" className="btn btn-primary">Open feed</Link>} />}
      {list.status === 'ready' && list.items.length > 0 && (
        <>
          <ul className="card card-pad list" style={{ listStyle: 'none', margin: 0 }} aria-label="Notifications">
            {list.items.map((n) => (
              <li key={n.id} className="list-row" style={{ flexWrap: 'wrap' }} data-unread={wasUnread.has(n.id) || !n.read} data-testid="notification">
                <div className="grow" style={{ minWidth: 0 }}>
                  <p className="break" style={{ margin: 0 }}>
                    {wasUnread.has(n.id) && <span className="chip chip-demo" style={{ marginRight: 8 }}>New</span>}
                    {n.type === 'match' ? <span>You matched with <b>{n.actorName}</b></span> : <><Link to={`/u/${n.actorId}`} className="name">{n.actorName}</Link>{' '}
                    <span>{notificationText(n).slice(n.actorName.length).trimStart()}</span></>}
                  </p>
                  <span className="subtle">{postedAgo(n.createdAt)}</span>
                </div>
                {n.type === 'follow_request' && n.followStatus === 'pending' && (
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void respond(n, true)}>Accept</button>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => void respond(n, false)}>Decline</button>
                  </div>
                )}
                {(n.type === 'like' || n.type === 'comment') && n.postId && <Link to={`/p/${n.postId}`} className="btn btn-ghost btn-sm">View post</Link>}
                {n.type === 'match' && <Link to="/connections?tab=matches" className="btn btn-secondary btn-sm">See your matches</Link>}
              </li>
            ))}
          </ul>
          <LoadMore visible={!!list.next} state={list.more} error={list.error} onMore={list.loadMore} />
        </>
      )}
    </div>
  );
}
