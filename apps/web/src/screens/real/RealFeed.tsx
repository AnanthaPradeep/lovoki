import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useSocial } from '../../social/SocialProvider';
import { usePostList } from '../../social/usePagedList';
import { PostList, NotificationsLink } from '../../social/PostList';
import { Composer } from '../../social/Composer';
import { SuggestedPeople } from '../../social/People';
import { useTitle } from '../../ui/useTitle';

type View = 'following' | 'explore';

export function RealFeed() {
  useTitle('Feed');
  const { api } = useSocial();
  const [view, setView] = useState<View>('following');
  const [visited, setVisited] = useState<Record<View, boolean>>({ following: true, explore: false });
  const [composer, setComposer] = useState(false);
  const following = usePostList((c) => api.feed('following', c), 'following');
  const explore = usePostList((c) => api.feed('explore', c), 'explore', visited.explore);
  const pick = (v: View) => { setView(v); setVisited((s) => ({ ...s, [v]: true })); };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Feed</h1><p className="sub">Posts from people on LOVOKI</p></div>
        <div className="row"><Link to="/search" className="icon-btn" aria-label="Search people"><Search size={22} aria-hidden /></Link><NotificationsLink /><button type="button" className="btn btn-primary" onClick={() => setComposer(true)}><Plus size={18} aria-hidden />New post</button></div>
      </div>
      <div className="segmented" role="tablist" aria-label="Feed view" style={{ marginBottom: 20 }}>
        {(['following', 'explore'] as const).map((v) => (
          <button type="button" key={v} role="tab" id={`tab-${v}`} aria-selected={view === v} aria-controls="feed-panel" onClick={() => pick(v)}>{v === 'following' ? 'Following' : 'Explore'}</button>
        ))}
      </div>
      <div role="tabpanel" id="feed-panel" aria-labelledby={`tab-${view}`}>
        {view === 'following' ? (<>
          {following.status === 'ready' && following.state.items.length === 0 && <div style={{ marginBottom: 24 }}><SuggestedPeople /></div>}
          <PostList list={following} empty={{
            title: 'Nothing here yet', body: 'You’ll see your own posts and posts from people you follow. Explore is the place to find people.',
            action: <button type="button" className="btn btn-primary" onClick={() => pick('explore')}>Browse Explore</button> }} /></>
        ) : (
          <PostList list={explore} empty={{ title: 'No public posts yet', body: 'Public posts from people with public profiles appear here. Be the first to share something.',
            action: <button type="button" className="btn btn-primary" onClick={() => setComposer(true)}>Write a post</button> }} />
        )}
      </div>
      <Composer open={composer} onClose={() => setComposer(false)} onPosted={() => { following.reload(); if (visited.explore) explore.reload(); }} />
    </div>
  );
}
