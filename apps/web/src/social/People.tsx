import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SocialFailure, SubmitGuard, type MediaRef, type PersonCard } from '@lovoki/core';
import { Dialog, Notice, useToast } from '../ui';
import { LoadError, LoadMore, LockMark, PersonAvatar, SampleBadge } from './parts';
import { useMediaUrls, useSocial } from './SocialProvider';
import { useHideSamples } from './devTools';
import { usePageList } from './usePagedList';

const refsOf = (cards: PersonCard[]): MediaRef[] => cards.flatMap((c) => (c.photoPath ? [{ bucket: 'profile-photos' as const, path: c.photoPath }] : []));

/** One person: avatar (blurred when the real picture is not theirs to show), @handle, name, lock and sample marks. */
export function PersonItem({ card, url, onNavigate, trailing }: { card: PersonCard; url?: string; onNavigate?: () => void; trailing?: React.ReactNode }) {
  const to = card.username ? `/@${card.username}` : `/u/${card.userId}`;
  return (
    <li className="list-row" style={{ minHeight: 64, gap: 12 }}>
      <Link to={to} onClick={onNavigate} className="row grow" style={{ gap: 12, minWidth: 0, textDecoration: 'none', color: 'inherit', minHeight: 44 }}>
        <PersonAvatar name={card.displayName} url={url} size={48} crop={card.avatarCrop} blurhash={card.avatarBlurhash} locked={card.isPrivate && !url} />
        <span className="grow" style={{ minWidth: 0, display: 'grid' }}>
          <span className="name truncate">{card.username ? `@${card.username}` : card.displayName}{card.isPrivate && <> <LockMark /></>}{card.isSample && <> <SampleBadge /></>}</span>
          <span className="subtle truncate">{card.displayName}</span>
        </span>
      </Link>
      {trailing}
    </li>
  );
}

/** Followers or following of a profile. The server returns an empty page when the lists are not yours to see. */
export function PeopleDialog({ handle, kind, open, onClose }: { handle: string; kind: 'followers' | 'following'; open: boolean; onClose: () => void }) {
  const { api } = useSocial();
  const hide = useHideSamples();
  const list = usePageList<PersonCard>((c) => (kind === 'followers' ? api.followersOf(handle, c) : api.followingOf(handle, c)), `${handle}:${kind}`, open);
  const items = useMemo(() => list.items.filter((c) => !(hide && c.isSample)), [list.items, hide]);
  const { urls } = useMediaUrls(useMemo(() => refsOf(items), [items]));
  return (
    <Dialog open={open} onClose={onClose} title={kind === 'followers' ? 'Followers' : 'Following'} footer={<button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>}>
      {list.status === 'loading' && <div className="skeleton" style={{ height: 64 }} aria-busy="true" aria-label="Loading people" />}
      {list.status === 'error' && <LoadError message={list.error ?? 'Couldn’t load this list.'} onRetry={list.reload} />}
      {list.status === 'ready' && items.length === 0 && <p className="subtle" data-testid="people-empty">{kind === 'followers' ? 'No followers to show yet.' : 'Not following anyone you can see yet.'}</p>}
      {items.length > 0 && <ul className="list" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label={kind === 'followers' ? 'Followers' : 'Following'}>
        {items.map((c) => <PersonItem key={c.userId} card={c} url={c.photoPath ? urls.get(c.photoPath) : undefined} onNavigate={onClose} />)}
      </ul>}
      <LoadMore visible={!!list.next} state={list.more} error={list.error} onMore={list.loadMore} />
    </Dialog>
  );
}

/**
 * "Suggested": for an account that follows nobody yet. Public accounts only, same country first, then newest.
 * That is the whole rule. It is not personalised and the label says so.
 */
export function SuggestedPeople() {
  const { api } = useSocial();
  const toast = useToast();
  const hide = useHideSamples();
  const [cards, setCards] = useState<PersonCard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const guard = useRef(new SubmitGuard()).current;
  const load = useCallback(() => { setErr(null); api.suggested().then(setCards).catch((e) => setErr(e instanceof SocialFailure ? e.message : 'Couldn’t load suggestions.')); }, [api]);
  useEffect(() => { load(); }, [load]);
  const shown = useMemo(() => (cards ?? []).filter((c) => !(hide && c.isSample)), [cards, hide]);
  const { urls } = useMediaUrls(useMemo(() => refsOf(shown), [shown]));

  const follow = (c: PersonCard) => void guard.run(c.userId, async () => {
    try { const st = await api.follow(c.userId); setCards((cur) => (cur ?? []).map((x) => (x.userId === c.userId ? { ...x, followStatus: st } : x))); toast({ text: st === 'accepted' ? `You’re following ${c.displayName}.` : 'Request sent.' }); }
    catch (e) { toast({ text: e instanceof SocialFailure ? e.message : 'That didn’t work. Try again.', tone: 'error' }); }
  });

  if (err) return <LoadError message={err} onRetry={load} />;
  if (cards === null) return <div className="skeleton" style={{ height: 150 }} aria-busy="true" aria-label="Loading suggestions" />;
  if (!shown.length) return null;
  return (
    <section className="stack" style={{ gap: 12 }} aria-labelledby="suggested-h" data-testid="suggested">
      <div><h2 id="suggested-h" style={{ fontSize: 'var(--fs-title)' }}>Suggested</h2>
        <p className="subtle" style={{ margin: 0 }}>Public accounts, nearest first. Not personalised: you haven’t followed anyone yet.</p></div>
      <ul className="suggest-row" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Suggested people">
        {shown.map((c) => (
          <li key={c.userId} className="suggest-card">
            <Link to={c.username ? `/@${c.username}` : `/u/${c.userId}`} style={{ display: 'grid', justifyItems: 'center', gap: 6, textDecoration: 'none', color: 'inherit', minHeight: 44 }}>
              <PersonAvatar name={c.displayName} url={c.photoPath ? urls.get(c.photoPath) : undefined} size={64} crop={c.avatarCrop} blurhash={c.avatarBlurhash} />
              <span className="truncate" style={{ maxWidth: 136, fontWeight: 700 }}>{c.username ? `@${c.username}` : c.displayName}</span>
              <span className="subtle truncate" style={{ maxWidth: 136 }}>{c.displayName}</span>
            </Link>
            {c.isSample && <SampleBadge />}
            <button type="button" className={`btn btn-sm ${c.followStatus ? 'btn-secondary' : 'btn-primary'}`} disabled={!!c.followStatus || guard.isBusy(c.userId)} onClick={() => follow(c)}
              aria-label={c.followStatus === 'accepted' ? `Following ${c.displayName}` : c.followStatus === 'pending' ? `Requested ${c.displayName}` : `Follow ${c.displayName}`}>
              {c.followStatus === 'accepted' ? 'Following' : c.followStatus === 'pending' ? 'Requested' : 'Follow'}</button>
          </li>
        ))}
      </ul>
      {shown.some((c) => c.isSample) && <Notice>Accounts marked Sample are fictional and are only here while LOVOKI is in development.</Notice>}
    </section>
  );
}
