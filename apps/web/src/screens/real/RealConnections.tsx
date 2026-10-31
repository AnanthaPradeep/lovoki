import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HeartHandshake, MessageCircle, Users } from 'lucide-react';
import { DatingFailure, SocialFailure, bucketLabel, matchedAgo, type MatchView, type MediaRef, type PeopleKind, type PersonRow, type SocialCounts } from '@lovoki/core';
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
  const [params, setParams] = useSearchParams();
  const initial = params.get('tab');
  const [tab, setTabState] = useState<Tab>(initial === 'matches' || initial === 'followers' || initial === 'requests' ? initial : 'following');
  const setTab = (t: Tab) => { setTabState(t); setParams(t === 'following' ? {} : { tab: t }, { replace: true }); };
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
          ? <MatchesList onChanged={refreshUnread} />
          : <PeopleList key={tab} kind={tab} onChanged={() => { loadCounts(); refreshUnread(); }} />}
      </div>
    </div>
  );
}

function MatchesList({ onChanged }: { onChanged: () => void }) {
  const { dating } = useSocial();
  const toast = useToast();
  const list = usePageList<MatchView & { id: string }>((c) => dating.matches(c), 'matches');
  const [confirm, setConfirm] = useState<MatchView | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useMemo<MediaRef[]>(() => list.items.filter((m) => m.photoPaths[0]).map((m) => ({ bucket: 'profile-photos', path: m.photoPaths[0]! })), [list.items]);
  const { urls } = useMediaUrls(refs);

  const unmatch = async (m: MatchView) => {
    if (busy) return;
    setBusy(true);
    try { await dating.unmatch(m.matchId); list.setItems((cur) => cur.filter((x) => x.matchId !== m.matchId)); toast({ text: `You unmatched with ${m.displayName}.` }); onChanged(); }
    catch (e) { toast({ text: e instanceof DatingFailure ? e.message : 'Couldn’t unmatch. Try again.', tone: 'error' }); }
    finally { setBusy(false); }
  };

  if (list.status === 'loading') return <ListSkeleton />;
  if (list.status === 'error') return <LoadError message={list.error ?? 'Couldn’t load your matches.'} onRetry={list.reload} />;
  if (!list.items.length) return <EmptyState icon={<HeartHandshake size={28} />} title="No matches yet" body="When you and someone both like each other, you’ll match and they’ll appear here. Likes stay private until then." action={<Link to="/discover" className="btn btn-primary">Go to Discover</Link>} />;
  return (
    <>
      <div style={{ marginBottom: 12 }}><Notice>Messaging arrives in Phase 5. Until then, matches are saved here.</Notice></div>
      <ul className="card card-pad list" style={{ listStyle: 'none', margin: 0 }} aria-label="Matches">
        {list.items.map((m) => (
          <li key={m.matchId} className="list-row" style={{ flexWrap: 'wrap' }} data-testid="match-row">
            <Link to={`/discover/${m.userId}`} aria-label={`${m.displayName}’s profile`}><PersonAvatar name={m.displayName} url={m.photoPaths[0] ? urls.get(m.photoPaths[0]) : undefined} size={56} /></Link>
            <div className="grow" style={{ minWidth: 0 }}>
              <Link to={`/discover/${m.userId}`} className="name truncate" style={{ display: 'block', textDecoration: 'none' }}>{m.displayName}, {m.age}</Link>
              <span className="subtle">Matched {matchedAgo(m.matchedAt)}{bucketLabel(m.distanceBucket) ? ` · ${bucketLabel(m.distanceBucket)}` : ''}</span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-sm" disabled aria-disabled="true" title="Messaging arrives in Phase 5"><MessageCircle size={16} aria-hidden />Say hello</button>
              <Link to={`/discover/${m.userId}`} className="btn btn-secondary btn-sm">View</Link>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(m)}>Unmatch</button>
            </div>
          </li>
        ))}
      </ul>
      <LoadMore visible={!!list.next} state={list.more} error={list.error} onMore={list.loadMore} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title={`Unmatch with ${confirm?.displayName ?? 'them'}?`} confirmLabel="Unmatch"
        body="You’ll both disappear from each other’s Matches and Discover for good. They aren’t told, and this can’t be undone." onConfirm={() => { const m = confirm; if (m) void unmatch(m); }} />
    </>
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
