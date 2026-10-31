import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HeartHandshake, MoreHorizontal, Users, MessageCircle } from 'lucide-react';
import { INTENTION_LABEL, relativeTime, type Profile, type Match } from '@lovoki/core';
import { store, useAppState } from '../store';
import { Avatar, EmptyState, Menu, Notice } from '../ui';
import { useSafety } from '../components/dialogs';

type Tab = 'matches' | 'following' | 'followers';

export function Connections() {
  const s = useAppState();
  const [tab, setTab] = useState<Tab>('matches');
  const visible = (ids: string[]) => ids.filter((id) => !s.blocked.includes(id)).map((id) => s.profiles[id]!).filter(Boolean);
  const matches = s.matches.filter((m) => !s.blocked.includes(m.profileId));
  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: 'matches', label: 'Matches', n: matches.length },
    { id: 'following', label: 'Following', n: visible(s.following).length },
    { id: 'followers', label: 'Followers', n: visible(s.followers).length },
  ];

  return (
    <div className="page">
      <div className="page-head"><div><h1>Connections</h1><p className="sub">Romantic matches and social follows are kept separate</p></div></div>
      <div className="segmented" role="tablist" aria-label="Connection type" style={{ marginBottom: 20 }}>
        {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label} {t.n}</button>)}
      </div>
      <div role="tabpanel">
        {tab === 'matches' ? (
          matches.length ? <div className="card card-pad list">{matches.map((m) => <MatchRow key={m.profileId} match={m} profile={s.profiles[m.profileId]!} />)}</div>
            : <EmptyState icon={<HeartHandshake size={28} />} title="No matches yet" body="When you and someone both like each other, you’ll match and can start talking."
              action={<Link to="/discover" className="btn btn-primary">Go to Discover</Link>} />
        ) : (
          <>
            <div style={{ marginBottom: 16 }}><Notice>Following is social: it shows posts in your feed. It never creates a match or unlocks messages, and your likes in Discover stay private.</Notice></div>
            {visible(tab === 'following' ? s.following : s.followers).length ? (
              <div className="card card-pad list">{visible(tab === 'following' ? s.following : s.followers).map((p) => <SocialRow key={p.id} profile={p} />)}</div>
            ) : <EmptyState icon={<Users size={28} />} title={tab === 'following' ? 'You’re not following anyone' : 'No followers yet'}
              body={tab === 'following' ? 'Follow people from the feed to see their posts.' : 'Share posts in the feed so people can find you.'}
              action={<Link to="/feed" className="btn btn-primary">Open feed</Link>} />}
          </>
        )}
      </div>
    </div>
  );
}

function MatchRow({ match, profile: p }: { match: Match; profile: Profile }) {
  const s = useAppState();
  const safety = useSafety(p);
  const conv = s.conversations[p.id];
  const started = (conv?.messages.length ?? 0) > 0;
  return (
    <div className="list-row">
      <Link to={`/u/${p.id}`} aria-hidden tabIndex={-1}><span className="ring" style={{ display: 'inline-block' }}><Avatar profile={p} size={48} /></span></Link>
      <div className="grow">
        <Link to={`/u/${p.id}`} className="name truncate" style={{ display: 'block', textDecoration: 'none' }}>{p.name}</Link>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="subtle">Matched {relativeTime(match.matchedAt)} ago</span>
          <span className="subtle">{INTENTION_LABEL[p.intention]}</span>
          {match.demo && <span className="chip chip-demo">Demo</span>}
        </div>
      </div>
      <Link to={`/messages/${p.id}`} className={`btn btn-sm ${started ? 'btn-secondary' : 'btn-primary'}`}><MessageCircle size={16} aria-hidden />{started ? 'Open chat' : 'Say hello'}</Link>
      <Menu label={`Options for ${p.name}`} icon={<MoreHorizontal size={20} />} items={safety.items} />
      {safety.dialogs}
    </div>
  );
}

function SocialRow({ profile: p }: { profile: Profile }) {
  const s = useAppState();
  const following = s.following.includes(p.id);
  const safety = useSafety(p);
  return (
    <div className="list-row">
      <Link to={`/u/${p.id}`} aria-hidden tabIndex={-1}><Avatar profile={p} size={48} /></Link>
      <div className="grow"><Link to={`/u/${p.id}`} className="name truncate" style={{ display: 'block', textDecoration: 'none' }}>{p.name}</Link><span className="subtle">{p.area}</span></div>
      <button className={`btn btn-sm ${following ? 'btn-secondary' : 'btn-primary'}`} aria-pressed={following}
        onClick={() => (following ? store.unfollow(p.id) : store.follow(p.id))}>{following ? 'Following' : 'Follow back'}</button>
      <Menu label={`Options for ${p.name}`} icon={<MoreHorizontal size={20} />} items={safety.items} />
      {safety.dialogs}
    </div>
  );
}
