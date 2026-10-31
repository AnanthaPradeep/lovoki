import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, MessageCircle, Bookmark, Globe, Users, Plus, MoreHorizontal, LayoutGrid } from 'lucide-react';
import { feed, relativeTime, LIMITS, type Post } from '@lovoki/core';
import { store, useAppState } from '../store';
import { Avatar, EmptyState, Menu, Photo } from '../ui';
import { ComposerDialog, useSafety } from '../components/dialogs';

export function Feed() {
  const s = useAppState();
  const [view, setView] = useState<'following' | 'explore'>('following');
  const [composer, setComposer] = useState(false);
  const posts = useMemo(() => feed(s, view), [s, view]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Feed</h1><p className="sub">Photos and moments from people on LOVOKI</p></div>
        <button className="btn btn-primary" onClick={() => setComposer(true)}><Plus size={18} aria-hidden />New post</button>
      </div>
      <div className="segmented" role="tablist" aria-label="Feed view" style={{ marginBottom: 20 }}>
        {(['following', 'explore'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}>{v === 'following' ? 'Following' : 'Explore'}</button>
        ))}
      </div>
      <div className="stack" role="tabpanel" style={{ gap: 24 }}>
        {posts.length ? posts.map((p) => <PostCard key={p.id} post={p} />) : (
          <EmptyState icon={<LayoutGrid size={28} />} title={view === 'following' ? 'Nothing from people you follow yet' : 'No public posts yet'}
            body={view === 'following' ? 'Follow people from Explore to see their posts here.' : 'Be the first to share something.'}
            action={view === 'following' ? <button className="btn btn-primary" onClick={() => setView('explore')}>Browse Explore</button> : undefined} />
        )}
      </div>
      <ComposerDialog open={composer} onClose={() => setComposer(false)} />
    </div>
  );
}

export function PostCard({ post: p }: { post: Post }) {
  const s = useAppState();
  const author = p.authorId === 'me' ? s.me : s.profiles[p.authorId]!;
  const [expanded, setExpanded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [draft, setDraft] = useState('');
  const safety = useSafety(p.authorId === 'me' ? undefined : author);
  const href = p.authorId === 'me' ? '/me' : `/u/${author.id}`;
  const long = p.caption.length > 140;
  const following = s.following.includes(author.id);

  return (
    <article className="card post" aria-label={`Post by ${author.name}`}>
      <header className="post-head">
        <Link to={href} aria-hidden tabIndex={-1}><Avatar profile={author} size={40} /></Link>
        <div className="grow">
          <Link to={href} className="truncate" style={{ display: 'block' }}>{p.authorId === 'me' ? 'You' : author.name}</Link>
          <div className="row" style={{ gap: 8 }}>
            <span className="subtle">{relativeTime(p.createdAt)}</span>
            <span className="audience">{p.audience === 'public' ? <><Globe size={12} aria-hidden />Public</> : <><Users size={12} aria-hidden />Followers only</>}</span>
          </div>
        </div>
        {p.authorId !== 'me' && !following && <button className="btn btn-secondary btn-sm" onClick={() => store.follow(author.id)}>Follow</button>}
        {p.authorId !== 'me' && <Menu label="Post options" icon={<MoreHorizontal size={20} />} items={[
          ...(following ? [{ label: 'Unfollow', onSelect: () => store.unfollow(author.id) }] : []), ...safety.items]} />}
      </header>
      {p.photo ? <Photo photo={p.photo} /> : <div className="text-only">{p.caption}</div>}
      <div className="post-actions">
        <button className="icon-btn" aria-pressed={p.likedByMe} aria-label={p.likedByMe ? 'Unlike post' : 'Like post'} onClick={() => store.togglePostLike(p.id)}>
          <Heart size={24} className={p.likedByMe ? 'liked' : ''} fill={p.likedByMe ? 'currentColor' : 'none'} aria-hidden />
        </button>
        <span className="count">{p.likeCount}</span>
        <button className="icon-btn" aria-expanded={showComments} aria-label={`Comments (${p.comments.length})`} onClick={() => setShowComments((v) => !v)}><MessageCircle size={24} aria-hidden /></button>
        <span className="count">{p.comments.length}</span>
        <span className="grow" />
        <button className="icon-btn" aria-pressed={p.savedByMe} aria-label={p.savedByMe ? 'Remove from saved' : 'Save post'} onClick={() => store.togglePostSave(p.id)}>
          <Bookmark size={24} fill={p.savedByMe ? 'currentColor' : 'none'} aria-hidden />
        </button>
      </div>
      <div className="post-body">
        {p.photo && p.caption && <>
          <p className={`caption ${long && !expanded ? 'clamp' : ''}`}><b>{p.authorId === 'me' ? 'You' : author.name.split(' ')[0]}</b> {p.caption}</p>
          {long && <button className="link-btn" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>{expanded ? 'Show less' : 'Show more'}</button>}
        </>}
        {!showComments && p.comments.length > 0 && <button className="link-btn" onClick={() => setShowComments(true)}>View {p.comments.length} {p.comments.length === 1 ? 'comment' : 'comments'}</button>}
        {showComments && (
          <div className="comments">
            {p.comments.map((c) => {
              const a = c.authorId === 'me' ? 'You' : s.profiles[c.authorId]?.name.split(' ')[0] ?? 'Someone';
              return <p key={c.id} className="comment break"><b>{a}</b>{c.text}<span className="subtle"> {relativeTime(c.createdAt)}</span></p>;
            })}
            <form className="comment-form" onSubmit={(e) => { e.preventDefault(); store.addComment(p.id, draft); setDraft(''); }}>
              <label className="sr-only" htmlFor={`cmt-${p.id}`}>Add a comment</label>
              <input id={`cmt-${p.id}`} className="input" value={draft} maxLength={LIMITS.comment} onChange={(e) => setDraft(e.target.value)} placeholder="Add a comment" />
              <button className="btn btn-primary" disabled={!draft.trim()}>Post</button>
            </form>
          </div>
        )}
      </div>
      {safety.dialogs}
    </article>
  );
}

export function PostGrid({ posts }: { posts: Post[] }) {
  if (!posts.length) return <p className="muted">No posts yet.</p>;
  return (
    <div className="post-grid">
      {posts.map((p) => p.photo ? <Photo key={p.id} photo={p.photo} /> : <div key={p.id} className="text-tile">{p.caption.slice(0, 80)}</div>)}
    </div>
  );
}
