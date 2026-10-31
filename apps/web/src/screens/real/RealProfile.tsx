import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Ban, Flag, Lock, MapPin, MoreHorizontal, UserX } from 'lucide-react';
import { SocialFailure, followAction, followActionLabel, genderLabel, type SocialProfileView } from '@lovoki/core';
import { DetailList } from '../../profile/parts';
import { EmptyState, Menu, Notice, useToast } from '../../ui';
import { useTitle } from '../../ui/useTitle';
import { useMediaUrls, useSocial } from '../../social/SocialProvider';
import { usePostList } from '../../social/usePagedList';
import { PostList } from '../../social/PostList';
import { LoadError, PersonAvatar, SocialImage } from '../../social/parts';
import { BlockDialog, ReportDialog } from '../../social/safety';

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'missing' } | { kind: 'ready'; profile: SocialProfileView };

/**
 * Another person's profile on social surfaces. It only ever receives what the server's social_profile() returns:
 * no date of birth, no dating preferences, no discoverability. A followers-only profile shows a name until accepted.
 */
export function RealProfile({ userId: forced }: { userId?: string } = {}) {
  const { id: routeId = '' } = useParams();
  const id = forced ?? routeId;
  const { api, userId } = useSocial();
  const toast = useToast();
  const [st, setSt] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [dlg, setDlg] = useState<null | 'report' | 'block'>(null);
  const load = useCallback(() => {
    setSt({ kind: 'loading' });
    api.profile(id).then((p) => setSt(p ? { kind: 'ready', profile: p } : { kind: 'missing' }))
      .catch((e) => setSt({ kind: 'error', message: e instanceof SocialFailure ? e.message : 'Couldn’t load this profile.' }));
  }, [api, id]);
  useEffect(() => { load(); }, [load]);

  const p = st.kind === 'ready' ? st.profile : null;
  useTitle(p ? p.displayName : 'Profile');
  const refs = useMemo(() => (p?.photoPath ? [{ bucket: 'profile-photos' as const, path: p.photoPath }] : []), [p?.photoPath]);
  const { urls, settled } = useMediaUrls(refs);
  const posts = usePostList((c) => api.authorPosts(id, c), `author:${id}`, !!p && !p.restricted);

  if (id === userId || p?.isSelf) return <Navigate to="/me" replace />;

  const act = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); toast({ text: done }); load(); }
    catch (e) { toast({ text: e instanceof SocialFailure ? e.message : 'That didn’t work. Try again.', tone: 'error' }); }
    finally { setBusy(false); }
  };

  if (st.kind === 'loading') return <div className="page stack" aria-busy="true" aria-label="Loading profile"><div className="skeleton" style={{ height: 32, width: 200 }} /><div className="skeleton" style={{ aspectRatio: '4 / 5', borderRadius: 22, maxHeight: 420 }} /></div>;
  if (st.kind === 'error') return <div className="page"><LoadError message={st.message} onRetry={load} /></div>;
  if (!p) return (
    <div className="page"><EmptyState icon={<UserX size={28} />} title="This profile isn’t available" body="It may not exist, may not have finished setting up, or you may no longer be able to see it."
      action={<Link to="/feed" className="btn btn-primary">Back to the feed</Link>} /></div>
  );

  const action = followAction(p);
  const label = followActionLabel[action];

  return (
    <div className="page stack" style={{ gap: 24 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div style={{ minWidth: 0 }}><h1 className="truncate">{p.displayName}{p.age !== null && <span className="age">, {p.age}</span>}</h1>{p.username && <p className="subtle" style={{ margin: 0 }} data-testid="handle">@{p.username}</p>}</div>
        <Menu label="Profile options" icon={<MoreHorizontal size={20} />} items={[
          { label: 'Report profile', icon: <Flag size={18} />, onSelect: () => setDlg('report') },
          { label: `Block ${p.displayName}`, icon: <Ban size={18} />, danger: true, onSelect: () => setDlg('block') }]} />
      </div>
      <article className="card card-pad stack" style={{ gap: 16 }} aria-label={`${p.displayName}’s profile`}>
        <div className="row" style={{ gap: 16, alignItems: 'center' }}>
          <PersonAvatar name={p.displayName} url={p.photoPath ? urls.get(p.photoPath) : undefined} size={72} crop={p.avatarCrop} />
          <div className="grow" style={{ minWidth: 0 }}>
            {p.areaLabel && <p className="row" style={{ margin: 0, gap: 6 }}><MapPin size={16} aria-hidden /><span className="break">{p.areaLabel}</span></p>}
            {(p.pronouns || p.gender) && <p className="subtle" style={{ margin: 0 }}>{[p.pronouns, genderLabel(p.gender as never, p.genderCustom)].filter(Boolean).join(' · ')}</p>}
            {!p.restricted && <p className="subtle" style={{ margin: 0 }} data-testid="counts">{p.postCount} posts · {p.followerCount} followers · {p.followingCount} following</p>}
          </div>
        </div>
        {p.bio && <p className="break" style={{ margin: 0 }}>{p.bio}</p>}
        <DetailList details={p.details} />
        {p.interests.length > 0 && <div className="chips">{p.interests.map((i) => <span className="chip" key={i}>{i}</span>)}</div>}
        {p.prompts.map((q) => <div key={q.question} className="dc-note" style={{ margin: 0 }}><div className="q">{q.question}</div><blockquote className="break">{q.answer}</blockquote></div>)}
        {p.photoPath && <SocialImage url={urls.get(p.photoPath)} settled={settled} alt={`${p.displayName}’s main photo`} />}
        {action !== 'none' && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={`btn ${action === 'follow' || action === 'request' ? 'btn-primary' : 'btn-secondary'}`} disabled={busy} aria-busy={busy}
              aria-pressed={action === 'unfollow' || action === 'cancel'}
              onClick={() => void act(() => (action === 'unfollow' || action === 'cancel' ? api.unfollow(p.userId) : api.follow(p.userId)),
                action === 'follow' ? `You’re following ${p.displayName}.` : action === 'request' ? 'Request sent.' : action === 'cancel' ? 'Request cancelled.' : `Unfollowed ${p.displayName}.`)}>{label}</button>
            {p.followsMeStatus === 'accepted' && <span className="chip">Follows you</span>}
            {p.followsMeStatus === 'pending' && <span className="chip">Asked to follow you. See Connections.</span>}
          </div>
        )}
      </article>
      {p.restricted ? (
        <Notice><Lock size={14} aria-hidden style={{ verticalAlign: -2, marginRight: 6 }} />This profile is followers-only. {p.followStatus === 'pending' ? 'Your request is waiting for them to accept.' : 'Send a request to see their photo, bio and posts.'}</Notice>
      ) : (
        <PostList list={posts} empty={{ title: 'No posts yet', body: `${p.displayName} hasn’t shared anything you can see.` }} />
      )}
      <ReportDialog open={dlg === 'report'} onClose={() => setDlg(null)} target="profile" targetId={p.userId} subject="profile" />
      <BlockDialog open={dlg === 'block'} onClose={() => setDlg(null)} name={p.displayName}
        onBlocked={async () => { await api.block(p.userId); toast({ text: `${p.displayName} is blocked.` }); setSt({ kind: 'missing' }); }} />
    </div>
  );
}

/** /@handle: resolves the handle to a person you may see, then shows the same profile. Unknown, blocked and hidden all read the same. */
export function RealProfileByHandle({ handle }: { handle: string }) {
  const { api } = useSocial();
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => { let alive = true; setId(undefined); api.resolveUsername(handle).then((r) => { if (alive) setId(r); }).catch(() => { if (alive) setId(null); }); return () => { alive = false; }; }, [api, handle]);
  if (id === undefined) return <div className="page stack" aria-busy="true" aria-label="Loading profile"><div className="skeleton" style={{ height: 32, width: 200 }} /></div>;
  if (id === null) return <div className="page"><EmptyState icon={<UserX size={28} />} title="This profile isn’t available" body="It may not exist, may not have finished setting up, or you may no longer be able to see it." action={<Link to="/feed" className="btn btn-primary">Back to the feed</Link>} /></div>;
  return <RealProfile userId={id} />;
}
