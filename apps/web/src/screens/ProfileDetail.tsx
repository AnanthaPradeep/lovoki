import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Heart, X, MessageCircle, MapPin, Briefcase, ShieldCheck, MoreHorizontal, UserX, Check } from 'lucide-react';
import { INTENTION_LABEL, formatCount, isMatched, postsBy, type Profile } from '@lovoki/core';
import { store, useAppState } from '../store';
import { EmptyState, Menu, Photo, useToast } from '../ui';
import { MatchDialog, useSafety } from '../components/dialogs';
import { PostGrid } from './Feed';

/** Demo profiles have no stored username: the handle is derived from the name, the same way for every screen. */
export const demoHandle = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');

export function ProfileDetail({ forcedId }: { forcedId?: string } = {}) {
  const { id: routeId = '' } = useParams();
  const id = forcedId ?? routeId;
  const s = useAppState();
  const nav = useNavigate();
  const p = s.profiles[id];
  const blocked = s.blocked.includes(id);
  const safety = useSafety(p, { afterBlock: () => nav(-1) });
  const posts = useMemo(() => (p ? postsBy(s, p.id) : []), [s, p]);
  const [match, setMatch] = useState<Profile | null>(null);
  const toast = useToast();

  if (!p || blocked) {
    return <div className="page"><EmptyState icon={<UserX size={28} />} title="Profile not available"
      body={blocked ? 'You blocked this person. Unblock them in Settings to see their profile.' : 'This profile may have been removed.'}
      action={<Link to="/discover" className="btn btn-primary">Back to Discover</Link>} /></div>;
  }
  const first = p.name.split(' ')[0];
  const matched = isMatched(s, p.id);
  const liked = s.liked.includes(p.id);
  const following = s.following.includes(p.id);

  return (
    <div className="page stack" style={{ gap: 24 }}>
      <div className="row"><button className="back" onClick={() => nav(-1)}><ArrowLeft size={18} aria-hidden />Back</button><span className="grow" />
        <Menu label={`More options for ${first}`} icon={<MoreHorizontal size={22} />} items={safety.items} /></div>

      <div className="gallery" data-count={Math.min(p.photos.length, 3)}>{p.photos.slice(0, 3).map((ph) => <Photo key={ph.id} photo={ph} />)}</div>

      <header className="stack" style={{ gap: 12 }}>
        <h1 className="profile-name">{p.name}<span className="muted" style={{ fontWeight: 400 }}>, {p.age}</span></h1>
        <p className="subtle row" style={{ margin: 0, gap: 8, flexWrap: 'wrap', minWidth: 0 }} data-testid="demo-handle"><span className="break" style={{ minWidth: 0 }}>@{demoHandle(p.name)}</span> <span className="badge-sample" title="Demo mode: made-up people on this device only">Demo</span></p>
        <ul className="ph-counts" data-testid="counts" aria-label="Counts">
          <li><span style={{ display: 'grid', minHeight: 44, alignContent: 'center' }}><b>{formatCount(posts.length)}</b><span className="lbl">{posts.length === 1 ? 'post' : 'posts'}</span></span></li>
          <li><span style={{ display: 'grid', minHeight: 44, alignContent: 'center' }}><b>{formatCount(p.followers)}</b><span className="lbl">{p.followers === 1 ? 'follower' : 'followers'}</span></span></li>
          <li><span style={{ display: 'grid', minHeight: 44, alignContent: 'center' }}><b>{formatCount(p.following)}</b><span className="lbl">following</span></span></li>
        </ul>
        <div className="dc-meta">
          <span><MapPin size={16} aria-hidden />{p.area}, about {p.distanceKm} km</span>
          {p.work && <span><Briefcase size={16} aria-hidden />{p.work}</span>}
        </div>
        <div className="chips">
          {matched && <span className="chip chip-match">You matched</span>}
          <span className="chip chip-dating">{INTENTION_LABEL[p.intention]}</span>
        </div>
        <div className="profile-actions">
          {matched ? <Link to={`/messages/${p.id}`} className="btn btn-primary"><MessageCircle size={18} aria-hidden />Message</Link>
            : liked ? <span className="chip">You liked {first}. Waiting to see if it’s mutual.</span>
            : <>
              <button className="btn btn-secondary" onClick={() => { store.pass(p.id); nav('/discover'); }}><X size={18} aria-hidden />Pass</button>
              <button className="btn btn-primary" onClick={async () => {
                try { const { matched: m } = await store.like(p.id); if (m) setMatch(p); else toast({ text: `You liked ${first}.` }); }
                catch { toast({ text: 'Couldn’t send your like.', tone: 'error' }); }
              }}><Heart size={18} aria-hidden />Like</button>
            </>}
          <button className="btn btn-secondary btn-toggle" aria-pressed={following} onClick={() => (following ? store.unfollow(p.id) : store.follow(p.id))}>
            {following ? <><Check size={18} aria-hidden />Following</> : 'Follow posts'}
          </button>
        </div>
        <p className="subtle">Following shows their public posts in your feed. It doesn’t create a match.</p>
      </header>

      <section className="stack">
        <h2 className="section-title">About {first}</h2>
        <p className="break">{p.bio}</p>
        <div className="facts">
          <div className="fact"><span className="grow">Age, area, work and intention</span><span className="source">Self-described</span></div>
          <div className="fact">
            <ShieldCheck size={18} aria-hidden /><span className="grow">{p.verification === 'demo-photo-check' ? 'Photo check' : 'Not verified'}</span>
            <span className="source">{p.verification === 'demo-photo-check' ? 'Demo state, not a real check' : 'No verification yet'}</span>
          </div>
        </div>
      </section>

      {p.prompts.map((pr) => <div className="prompt-card" key={pr.question}><div className="q">{pr.question}</div><p>{pr.answer}</p></div>)}

      <section><h2 className="section-title">Interests</h2><div className="chips">{p.interests.map((i) => <span className="chip" key={i}>{i}</span>)}</div></section>

      <section>
        <div className="row" style={{ marginBottom: 12 }}><h2 className="section-title grow" style={{ margin: 0 }}>Posts</h2>
          <span className="subtle">{p.followers} followers</span></div>
        <PostGrid posts={posts} />
      </section>
      {safety.dialogs}
      <MatchDialog profile={match} onClose={() => setMatch(null)} />
    </div>
  );
}
