import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Ban, Copy, Flag, Lock, MapPin, MoreHorizontal, Pencil, Settings, Share2, UserX } from 'lucide-react';
import { SocialFailure, SubmitGuard, followAction, formatCount, genderLabel, privateLockCopy, type SocialProfileView } from '@lovoki/core';
import { DetailList } from '../../profile/parts';
import { ConfirmDialog, EmptyState, Menu, Notice, useToast } from '../../ui';
import { useTitle } from '../../ui/useTitle';
import { useMediaUrls, useSocial } from '../../social/SocialProvider';
import { usePostList } from '../../social/usePagedList';
import { PostGrid } from '../../social/PostGrid';
import { PeopleDialog } from '../../social/People';
import { useHideSamples } from '../../social/devTools';
import { LoadError, LockMark, PersonAvatar, SampleBadge } from '../../social/parts';
import { BlockDialog, ReportDialog } from '../../social/safety';

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'missing' } | { kind: 'ready'; profile: SocialProfileView };
type Tab = 'posts' | 'saved' | 'about';

const NOT_AVAILABLE = { title: 'This profile isn’t available', body: 'It may not exist, may not have finished setting up, or you may no longer be able to see it.' };

/**
 * /@handle for anyone, yourself included. It only ever shows what the database's get_social_profile() returned for your
 * relationship: no date of birth, no dating preferences, no discoverability. A private account shows a lock, never a grid.
 */
export function ProfileScreen({ handle }: { handle: string }) {
  const { api } = useSocial();
  const toast = useToast();
  const hideSamples = useHideSamples();
  const [st, setSt] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('posts');
  const [dlg, setDlg] = useState<null | 'report' | 'block' | 'unfollow' | 'followers' | 'following'>(null);
  const guard = useRef(new SubmitGuard()).current;

  const load = useCallback((quiet = false) => {
    if (!quiet) setSt({ kind: 'loading' });
    api.profileByHandle(handle).then((p) => setSt(p ? { kind: 'ready', profile: p } : { kind: 'missing' }))
      .catch((e) => setSt({ kind: 'error', message: e instanceof SocialFailure ? e.message : 'Couldn’t load this profile.' }));
  }, [api, handle]);
  useEffect(() => { setTab('posts'); load(); }, [load]);

  const p = st.kind === 'ready' ? st.profile : null;
  useTitle(p ? `${p.displayName} (@${p.username ?? handle})` : 'Profile');
  const refs = useMemo(() => (p?.photoPath ? [{ bucket: 'profile-photos' as const, path: p.photoPath }] : []), [p?.photoPath]);
  const { urls } = useMediaUrls(refs);
  const canSeePosts = !!p && !p.restricted;
  const posts = usePostList((c) => api.profilePosts(handle, c), `posts:${handle}`, canSeePosts);
  const saved = usePostList((c) => api.savedPosts(c), 'saved', !!p?.isSelf && tab === 'saved');

  const toggleFollow = (current: ReturnType<typeof followAction>, who: SocialProfileView) => {
    void guard.run('follow', async () => {
      setBusy(true);
      try {
        if (current === 'unfollow' || current === 'cancel') await api.unfollow(who.userId); else await api.follow(who.userId);
        toast({ text: current === 'follow' ? `You’re following ${who.displayName}.` : current === 'request' ? 'Request sent.' : current === 'cancel' ? 'Request cancelled.' : `Unfollowed ${who.displayName}.` });
        load(true);
      } catch (e) { toast({ text: e instanceof SocialFailure ? e.message : 'That didn’t work. Try again.', tone: 'error' }); }
      finally { setBusy(false); }
    });
  };

  const link = `${location.origin}/@${p?.username ?? handle}`;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); toast({ text: 'Link copied.' }); }
    catch { toast({ text: `Copy this link: ${link}` }); }
  };
  const share = async () => {
    const nv = navigator as Navigator & { share?: (d: { url: string; title: string }) => Promise<void> };
    if (typeof nv.share === 'function' && matchMedia('(pointer: coarse)').matches) { try { await nv.share({ url: link, title: `${p?.displayName ?? ''} on LOVOKI` }); return; } catch { /* cancelled: fall through to copy */ } }
    await copyLink();
  };

  if (st.kind === 'loading') return <div className="page stack" aria-busy="true" aria-label="Loading profile"><div className="row" style={{ gap: 16 }}><div className="skeleton" style={{ width: 80, height: 80, borderRadius: '50%' }} /><div className="skeleton" style={{ height: 24, width: 180 }} /></div><div className="skeleton" style={{ height: 14, width: '60%' }} /></div>;
  if (st.kind === 'error') return <div className="page"><LoadError message={st.message} onRetry={() => load()} /></div>;
  if (!p) return <div className="page"><EmptyState icon={<UserX size={28} />} title={NOT_AVAILABLE.title} body={NOT_AVAILABLE.body} action={<Link to="/feed" className="btn btn-primary">Back to the feed</Link>} /></div>;

  const action = followAction(p);
  const lock = privateLockCopy(p);
  const name = p.username ?? handle;
  const listsOpen = !p.restricted && p.followerCount !== null;
  const countItem = (n: number | null, label: string, which?: 'followers' | 'following') => (
    <li>
      {which && listsOpen
        ? <button type="button" className="count-btn" onClick={() => setDlg(which)} aria-label={`${n ?? 0} ${label}`}><b>{formatCount(n)}</b><span className="lbl">{label}</span></button>
        : <span style={{ display: 'grid', minHeight: 44, alignContent: 'center' }} aria-label={n === null ? `${label} hidden` : `${n} ${label}`}><b>{formatCount(n)}</b><span className="lbl">{label}</span></span>}
    </li>
  );
  const followBtn = action === 'none' ? null : (
    <button type="button" className={`btn ${action === 'follow' || action === 'request' ? 'btn-primary' : 'btn-secondary'}`} disabled={busy} aria-busy={busy}
      onClick={() => (action === 'unfollow' ? setDlg('unfollow') : toggleFollow(action, p))}>
      {action === 'follow' ? 'Follow' : action === 'request' ? 'Request to follow' : action === 'cancel' ? 'Requested' : 'Following'}
    </button>
  );

  return (
    <div className="page stack" style={{ gap: 20 }}>
      <header className="ph" aria-label={`${p.displayName}’s profile`}>
        <div className="ph-avatar"><PersonAvatar name={p.displayName} url={p.photoPath ? urls.get(p.photoPath) : undefined} size={96} crop={p.avatarCrop} blurhash={p.avatarBlurhash} locked={p.isPrivate} /></div>
        <div className="ph-top">
          <h1 className="truncate" data-testid="handle">@{name}</h1>
          {p.isPrivate && <LockMark size={18} />}{p.isSample && <SampleBadge />}
          <span className="grow" />
          <Menu label="Profile options" icon={<MoreHorizontal size={20} />} items={[
            { label: 'Copy link', icon: <Copy size={18} />, onSelect: () => void copyLink() },
            ...(p.isSelf ? [] : [{ label: 'Report profile', icon: <Flag size={18} />, onSelect: () => setDlg('report') },
              { label: `Block ${p.displayName}`, icon: <Ban size={18} />, danger: true, onSelect: () => setDlg('block') }])]} />
        </div>
        <ul className="ph-counts" data-testid="counts" aria-label="Counts">
          {countItem(p.postCount, p.postCount === 1 ? 'post' : 'posts')}{countItem(p.followerCount, p.followerCount === 1 ? 'follower' : 'followers', 'followers')}{countItem(p.followingCount, 'following', 'following')}
        </ul>
        <div className="ph-bio">
          <p style={{ fontWeight: 700 }} className="break">{p.displayName}{p.age !== null && <span className="age">, {p.age}</span>}</p>
          {(p.pronouns || p.gender) && <p className="subtle">{[p.pronouns, genderLabel(p.gender as never, p.genderCustom)].filter(Boolean).join(' · ')}</p>}
          {p.areaLabel && <p className="row" style={{ gap: 6 }}><MapPin size={16} aria-hidden /><span className="break">{p.areaLabel}</span></p>}
          {p.bio && <p data-testid="bio">{p.bio}</p>}
          {p.followsMeStatus === 'accepted' && <span className="chip" style={{ justifySelf: 'start' }}>Follows you</span>}
          {p.followsMeStatus === 'pending' && <span className="chip" style={{ justifySelf: 'start' }}>Asked to follow you. See Connections.</span>}
        </div>
        <div className="ph-actions">
          {p.isSelf ? (<>
            <Link to="/me/edit" className="btn btn-secondary"><Pencil size={16} aria-hidden />Edit profile</Link>
            <button type="button" className="btn btn-secondary" onClick={() => void share()}><Share2 size={16} aria-hidden />Share profile</button>
            <Link to="/settings" className="btn btn-ghost" aria-label="Settings"><Settings size={18} aria-hidden /><span className="sr-only">Settings</span></Link>
          </>) : !p.restricted && followBtn}
        </div>
      </header>

      {p.isSample && (
        <Notice>This is a <b>sample</b> profile: a fictional person, here only while LOVOKI is in development. {p.isPrivate ? 'Sample accounts never accept follow requests, so your request will stay pending.' : 'Following works, but nobody receives anything.'}</Notice>
      )}

      {p.restricted ? (
        <section className="lock-panel" aria-labelledby="lock-h" data-testid="lock-panel">
          <span className="lock-ring"><Lock size={28} aria-hidden /></span>
          <h2 id="lock-h" style={{ fontSize: 'var(--fs-title)' }}>{lock.title}</h2>
          <p className="muted" style={{ margin: 0 }}>{lock.body}</p>
          {followBtn}
        </section>
      ) : (
        <>
          <div className="profile-tabs" role="tablist" aria-label="Profile sections">
            {([['posts', 'Posts'], ...(p.isSelf ? [['saved', 'Saved']] : []), ['about', 'About']] as [Tab, string][]).map(([k, label]) => (
              <button type="button" key={k} role="tab" id={`pt-${k}`} aria-selected={tab === k} aria-controls="profile-panel" onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          <div role="tabpanel" id="profile-panel" aria-labelledby={`pt-${tab}`}>
            {tab === 'posts' && <PostGrid list={posts} hideSamples={hideSamples} empty={{ title: 'No posts yet', body: p.isSelf ? 'Share a photo or a thought from the Feed. You choose who can see it.' : `${p.displayName} hasn’t shared anything you can see.`, action: p.isSelf ? <Link to="/feed" className="btn btn-primary">Go to the feed</Link> : undefined }} />}
            {tab === 'saved' && p.isSelf && <div className="stack" style={{ gap: 12 }}><Notice>Only you can see what you’ve saved. The people who posted aren’t told.</Notice><PostGrid list={saved} hideSamples={hideSamples} empty={{ title: 'Nothing saved', body: 'Tap the bookmark on a post to keep it here.' }} /></div>}
            {tab === 'about' && (
              <div className="stack" style={{ gap: 16 }}>
                {p.bio ? <p className="break" style={{ margin: 0, whiteSpace: 'pre-line' }}>{p.bio}</p> : <p className="subtle">No bio yet.</p>}
                <DetailList details={p.details} />
                {p.interests.length > 0 && <div className="chips">{p.interests.map((i) => <span className="chip" key={i}>{i}</span>)}</div>}
                {p.prompts.map((q) => <div key={q.question} className="dc-note" style={{ margin: 0 }}><div className="q">{q.question}</div><blockquote className="break">{q.answer}</blockquote></div>)}
              </div>
            )}
          </div>
        </>
      )}

      <PeopleDialog handle={name} kind="followers" open={dlg === 'followers'} onClose={() => setDlg(null)} />
      <PeopleDialog handle={name} kind="following" open={dlg === 'following'} onClose={() => setDlg(null)} />
      <ConfirmDialog open={dlg === 'unfollow'} onClose={() => setDlg(null)} title={`Unfollow @${name}?`} confirmLabel="Unfollow" danger={false}
        body={p.isPrivate ? 'This account is private. You would need to send a new request to follow again.' : 'You can follow again at any time.'} onConfirm={() => toggleFollow('unfollow', p)} />
      <ReportDialog open={dlg === 'report'} onClose={() => setDlg(null)} target="profile" targetId={p.userId} subject="profile" />
      <BlockDialog open={dlg === 'block'} onClose={() => setDlg(null)} name={p.displayName}
        onBlocked={async () => { await api.block(p.userId); toast({ text: `${p.displayName} is blocked.` }); setSt({ kind: 'missing' }); }} />
    </div>
  );
}

/** /@handle. */
export function RealProfileByHandle({ handle }: { handle: string }) { return <ProfileScreen handle={handle} />; }

/** /u/:id (notification and link targets). Resolves to the canonical /@handle. */
export function RealProfile({ userId: forced }: { userId?: string } = {}) {
  const { id: routeId = '' } = useParams();
  const id = forced ?? routeId;
  const { api, userId } = useSocial();
  const [to, setTo] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true; setTo(undefined);
    api.profile(id).then((p) => { if (alive) setTo(p?.username ? `/@${p.username}` : null); }).catch(() => { if (alive) setTo(null); });
    return () => { alive = false; };
  }, [api, id]);
  if (id === userId) return <Navigate to="/me" replace />;
  if (to === undefined) return <div className="page stack" aria-busy="true" aria-label="Loading profile"><div className="skeleton" style={{ height: 32, width: 200 }} /></div>;
  if (to === null) return <div className="page"><EmptyState icon={<UserX size={28} />} title={NOT_AVAILABLE.title} body={NOT_AVAILABLE.body} action={<Link to="/feed" className="btn btn-primary">Back to the feed</Link>} /></div>;
  return <Navigate to={to} replace />;
}
