import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Settings, ShieldCheck } from 'lucide-react';
import { completionPercent } from '@lovoki/core';
import { useReadyAccount } from '../../account/AccountProvider';
import { ProfilePreview } from '../../components/ProfilePreview';
import { VisibilityPanel } from '../../components/profileFields';
import { Notice } from '../../ui';
import { useSocial } from '../../social/SocialProvider';
import { usePostList } from '../../social/usePagedList';
import { NotificationsLink, PostList } from '../../social/PostList';
import { useTitle } from '../../ui/useTitle';

const CARD_TARGET: Record<string, string> = { about: 'about', photos: 'photos', essentials: 'essentials', languages: 'languages', lifestyle: 'lifestyle', family: 'family', links: 'links' };

export function RealMe() {
  useTitle('Your profile');
  const { account, api } = useReadyAccount();
  const social = useSocial();
  const [view, setView] = useState<'posts' | 'saved'>('posts');
  const mine = usePostList((c) => social.api.authorPosts(social.userId, c), 'mine');
  const saved = usePostList((c) => social.api.savedPosts(c), 'saved', view === 'saved');
  const done = completionPercent(account);
  const todo = done.cards.filter((c) => !c.done);
  return (
    <div className="page stack" style={{ gap: 24 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h1>Your profile</h1>
        <div className="row"><NotificationsLink /><Link to="/settings" className="btn btn-ghost"><Settings size={18} aria-hidden />Settings</Link><Link to="/me/edit" className="btn btn-primary"><Pencil size={18} aria-hidden />Edit profile</Link></div>
      </div>
      <section className="card card-pad stack" style={{ gap: 12 }} aria-labelledby="complete-h" data-testid="complete-profile">
        <div className="row"><h2 id="complete-h" className="grow" style={{ fontSize: 'var(--fs-title)' }}>Complete your profile</h2><b>{done.percent}%</b></div>
        <div className="meter" role="progressbar" aria-valuenow={done.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness"><div style={{ width: `${done.percent}%` }} /></div>
        {todo.length === 0 ? <p className="muted">Nice: that’s everything we suggest. All of it is optional, and you can change who sees what any time.</p> : (
          <>
            <p className="muted">All optional. Add what you’re comfortable sharing; nothing here stops you using LOVOKI.</p>
            <ul className="stack" style={{ gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
              {todo.slice(0, 5).map((c) => (
                <li key={c.id}><Link to={`/me/edit#${CARD_TARGET[c.group] ?? 'details'}`} className="list-row" style={{ minHeight: 56, border: '1px solid var(--c-border)', borderRadius: 'var(--radius-control)', textDecoration: 'none' }} data-testid="profile-card">
                  <span className="grow" style={{ minWidth: 0 }}><b>{c.title}</b><br /><span className="subtle">{c.body}</span></span><Plus size={18} aria-hidden /></Link></li>
              ))}
            </ul>
            {todo.length > 5 && <p className="subtle">{todo.length - 5} more in Edit profile.</p>}
          </>
        )}
      </section>
      <ProfilePreview account={account} api={api} />
      <div className="facts">
        <div className="fact"><ShieldCheck size={18} aria-hidden /><span className="grow">Not verified</span><span className="source">Verification isn’t available yet</span></div>
        <div className="fact"><span className="grow">Age</span><span className="source">Self-declared</span></div>
      </div>
      <section className="stack" style={{ gap: 16 }} aria-label="Your posts">
        <div className="segmented" role="tablist" aria-label="Your posts" style={{ justifySelf: 'start' }}>
          <button type="button" role="tab" id="me-tab-posts" aria-selected={view === 'posts'} aria-controls="me-panel" onClick={() => setView('posts')}>Your posts</button>
          <button type="button" role="tab" id="me-tab-saved" aria-selected={view === 'saved'} aria-controls="me-panel" onClick={() => setView('saved')}>Saved</button>
        </div>
        <div role="tabpanel" id="me-panel" aria-labelledby={`me-tab-${view}`}>
          {view === 'posts'
            ? <PostList list={mine} empty={{ title: 'No posts yet', body: 'Share a photo or a thought from the Feed. You choose who can see it.', action: <Link to="/feed" className="btn btn-primary">Go to the feed</Link> }} />
            : <><div style={{ marginBottom: 12 }}><Notice>Only you can see what you’ve saved. The people who posted aren’t told.</Notice></div>
                <PostList list={saved} empty={{ title: 'Nothing saved', body: 'Tap the bookmark on a post to keep it here.' }} /></>}
        </div>
      </section>
      <VisibilityPanel />
      <Notice>You’re signed in as <b className="break">{account.email}</b>. Your date of birth and email are private.</Notice>
    </div>
  );
}
