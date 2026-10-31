import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HeartHandshake, Users } from 'lucide-react';
import { SocialFailure, type MediaRef, type PeopleKind, type PersonRow, type SocialCounts } from '@lovoki/core';
import { ConfirmDialog, EmptyState, Notice, useToast } from '../../ui';
import { useTitle } from '../../ui/useTitle';
import { useMediaUrls, useSocial } from '../../social/SocialProvider';
import { usePageList } from '../../social/usePagedList';
import { ListSkeleton, LoadError, LoadMore, PersonAvatar } from '../../social/parts';
import { NotificationsLink } from '../../social/PostList';

type Tab = 'matches' | PeopleKind;
const LABEL: Record<Tab, string> = { matches: 'Matches', following: 'Following', followers: 'Followers', requests: 'Requests' };

export function RealConnections() {
  useTitle('Connections');
  const { api, refreshUnread } = useSocial();
  const [tab, setTab] = useState<Tab>('following');
  const [counts, setCounts] = useState<SocialCounts | null>(null);
  const loadCounts = useCallback(() => { api.counts().then(setCounts).catch(() => undefined); }, [api]);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  const n = (t: Tab) => (t === 'matches' || !counts ? null : counts[t]);

  return (
    <div className="page">
      <div className="page-head"><div><h1>Connections</h1><p className="sub">Follows are social. Matches are romantic and kept separate.</p></div><NotificationsLink /></div>
      <div className="segmented" role="tablist" aria-label="Connection type" style={{ marginBottom: 20, maxWidth: '100%', overflowX: 'auto' }}>
        {(['following', 'followers', 'requests', 'matches'] as const).map((t) => (
          <button type="button" key={t} role="tab" id={`ctab-${t}`} aria-selected={tab === t} aria-controls="conn-panel" onClick={() => setTab(t)}>
            {LABEL[t]}{n(t) !== null && <> <span className="subtle" aria-label={`${n(t)} ${LABEL[t].toLowerCase()}`}>{n(t)}</span></>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="conn-panel" aria-labelledby={`ctab-${tab}`}>
        {tab === 'matches'
          ? <EmptyState icon={<HeartHandshake size={28} />} title="Matches arrive in Phase 4" body="Matching and Discover aren’t built yet, so there is nothing to show here. Following people never creates a match."
              action={<Link to="/feed" className="btn btn-primary">Open the feed</Link>} />
          : <PeopleList key={tab} kind={tab} onChanged={() => { loadCounts(); refreshUnread(); }} />}
      </div>
    </div>
  );
}

function PeopleList({ kind, onChanged }: { kind: PeopleKind; onChanged: () => void }) {
  const { api } = useSocial();
  const toast = useToast();
  const list = usePageList<PersonRow>((c) => api.people(kind, c), kind);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PersonRow | null>(null);
  const refs = useMemo<MediaRef[]>(() => list.items.filter((p) => p.photoPath).map((p) => ({ bucket: 'profile-photos', path: p.photoPath! })), [list.items]);
  const { urls } = useMediaUrls(refs);

  const act = async (p: PersonRow, label: string, fn: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(p.userId + label);
    try { await fn(); list.setItems((cur) => cur.filter((x) => x.userId !== p.userId)); toast({ text: done }); onChanged(); }
    catch (e) { toast({ text: e instanceof SocialFailure ? e.message : 'That didn’t work. Try again.', tone: 'error', action: { label: 'Retry', run: () => void act(p, label, fn, done) } }); }
    finally { setBusy(null); }
  };

  if (list.status === 'loading') return <ListSkeleton />;
  if (list.status === 'error') return <LoadError message={list.error ?? 'Couldn’t load this list.'} onRetry={list.reload} />;
  if (!list.items.length) {
    const e = {
      following: { title: 'You’re not following anyone', body: 'Follow people from Explore to see their posts in your feed.' },
      followers: { title: 'No followers yet', body: 'People who follow you appear here. Posting makes it easier for others to find you.' },
      requests: { title: 'No follow requests', body: 'If your profile is followers-only, people ask to follow you and you accept or decline here.' },
    }[kind];
    return <EmptyState icon={<Users size={28} />} title={e.title} body={e.body} action={<Link to="/feed" className="btn btn-primary">Open feed</Link>} />;
  }
  return (
    <>
      {kind === 'requests' && <div style={{ marginBottom: 12 }}><Notice>Accepting lets someone see your followers-only profile and posts. Declining doesn’t notify them.</Notice></div>}
      <div className="card card-pad list">
        {list.items.map((p) => (
          <div key={p.userId} className="list-row" style={{ flexWrap: 'wrap' }} data-testid="person-row">
            <Link to={`/u/${p.userId}`} aria-label={`${p.displayName}’s profile`}><PersonAvatar name={p.displayName} url={p.photoPath ? urls.get(p.photoPath) : undefined} size={48} /></Link>
            <div className="grow" style={{ minWidth: 0 }}>
              <Link to={`/u/${p.userId}`} className="name truncate" style={{ display: 'block', textDecoration: 'none' }}>{p.displayName}</Link>
              {kind === 'following' && p.status === 'pending' && <span className="subtle">Waiting for them to accept</span>}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {kind === 'following' && <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy}
                onClick={() => void act(p, 'unfollow', () => api.unfollow(p.userId), p.status === 'pending' ? 'Request cancelled.' : `Unfollowed ${p.displayName}.`)}>{p.status === 'pending' ? 'Cancel request' : 'Unfollow'}</button>}
              {kind === 'followers' && <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => setConfirm(p)}>Remove</button>}
              {kind === 'requests' && <>
                <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void act(p, 'accept', () => api.respondToRequest(p.userId, true), `${p.displayName} can now see your posts.`)}>Accept</button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => void act(p, 'decline', () => api.respondToRequest(p.userId, false), 'Request declined.')}>Decline</button></>}
            </div>
          </div>
        ))}
      </div>
      <LoadMore visible={!!list.next} state={list.more} error={list.error} onMore={list.loadMore} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title={`Remove ${confirm?.displayName ?? 'follower'}?`} confirmLabel="Remove"
        body="They stop seeing your followers-only posts. They aren’t told, and they can ask to follow again."
        onConfirm={() => { const p = confirm; if (p) void act(p, 'remove', () => api.removeFollower(p.userId), `${p.displayName} was removed.`); }} />
    </>
  );
}
