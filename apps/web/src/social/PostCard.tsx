import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Bookmark, Flag, Globe, Heart, Lock, LockOpen, MessageCircle, MoreHorizontal, Send, Trash2, Users } from 'lucide-react';
import {
  SOCIAL_RULES, SocialFailure, SubmitGuard, charCount, postedAgo, validateComment,
  type CommentView, type PostAction, type PostView,
} from '@lovoki/core';
import { ConfirmDialog, Counter, Menu, Notice, useToast } from '../ui';
import { useSocial } from './SocialProvider';
import { LoadMore, PersonAvatar, SocialImage } from './parts';
import { usePageList } from './usePagedList';
import { BlockDialog, ReportDialog } from './safety';

interface Props {
  post: PostView;
  dispatch: (a: PostAction) => void;
  urls: Map<string, string>;
  settled: boolean;
}

const failText = (e: unknown, fallback: string) => (e instanceof SocialFailure ? e.message : fallback);

export function PostCard({ post: p, dispatch, urls, settled }: Props) {
  const { api } = useSocial();
  const toast = useToast();
  const guard = useRef(new SubmitGuard()).current;
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dlg, setDlg] = useState<null | 'delete' | 'report' | 'block'>(null);
  const [deleting, setDeleting] = useState(false);
  const long = p.caption.length > 140;
  const href = p.isMine ? '/me' : `/u/${p.authorId}`;
  const who = p.isMine ? 'You' : p.authorName;

  const toggleLike = useCallback(() => {
    if (p.rollback?.like) return; // a request is already in flight
    const wasLiked = p.likedByMe;
    dispatch({ type: 'like/start', id: p.id });
    void guard.run(`like:${p.id}`, async () => {
      try {
        const r = await (wasLiked ? api.unlike(p.id) : api.like(p.id));
        dispatch({ type: 'like/ok', id: p.id, liked: r.liked, likeCount: r.likeCount });
      } catch (e) {
        dispatch({ type: 'like/fail', id: p.id });
        toast({ text: failText(e, 'Couldn’t update your like.'), tone: 'error', action: { label: 'Retry', run: toggleLike } });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- toast and guard are stable
  }, [api, p.id, p.likedByMe, p.rollback?.like, dispatch]);

  const toggleSave = () => {
    if (p.rollback?.save !== undefined) return;
    const was = p.savedByMe;
    dispatch({ type: 'save/start', id: p.id });
    void guard.run(`save:${p.id}`, async () => {
      try {
        await (was ? api.unsave(p.id) : api.save(p.id));
        dispatch({ type: 'save/ok', id: p.id });
        toast({ text: was ? 'Removed from saved.' : 'Saved. Only you can see your saved posts.' });
      } catch (e) {
        dispatch({ type: 'save/fail', id: p.id });
        toast({ text: failText(e, 'Couldn’t update your saved posts.'), tone: 'error', action: { label: 'Retry', run: toggleSave } });
      }
    });
  };

  const del = async () => {
    if (deleting) return;
    setDeleting(true);
    try { await api.deletePost(p.id); dispatch({ type: 'remove', id: p.id }); toast({ text: 'Post deleted.' }); }
    catch (e) { toast({ text: failText(e, 'Couldn’t delete the post.'), tone: 'error', action: { label: 'Retry', run: () => void del() } }); }
    finally { setDeleting(false); }
  };

  const flipAudience = async () => {
    const next = p.audience === 'public' ? 'followers' : 'public';
    try {
      await api.setAudience(p.id, next);
      dispatch({ type: 'audience', id: p.id, audience: next });
      toast({ text: next === 'followers' ? 'Now visible to followers only.' : 'Now public.' });
    } catch (e) { toast({ text: failText(e, 'Couldn’t change who can see this.'), tone: 'error' }); }
  };

  const media = p.media ? urls.get(p.media.path) : undefined;
  const avatar = p.authorPhotoPath ? urls.get(p.authorPhotoPath) : undefined;

  return (
    <article className="card post" aria-label={`Post by ${who}`} data-post-id={p.id}>
      <header className="post-head">
        <Link to={href} aria-label={`${who}’s profile`}><PersonAvatar name={p.authorName} url={avatar} size={40} /></Link>
        <div className="grow" style={{ minWidth: 0 }}>
          <Link to={href} className="truncate" style={{ display: 'block' }}>{who}</Link>
          <div className="row" style={{ gap: 8 }}>
            <time className="subtle" dateTime={p.createdAt}>{postedAgo(p.createdAt)}</time>
            <span className="audience">{p.audience === 'public' ? <><Globe size={12} aria-hidden />Public</> : <><Users size={12} aria-hidden />Followers only</>}</span>
          </div>
        </div>
        <Menu label="Post options" icon={<MoreHorizontal size={20} />} items={p.isMine
          ? [{ label: p.audience === 'public' ? 'Make followers-only' : 'Make public', icon: p.audience === 'public' ? <Lock size={18} /> : <LockOpen size={18} />, onSelect: () => void flipAudience() },
             { label: 'Delete post', icon: <Trash2 size={18} />, danger: true, onSelect: () => setDlg('delete') }]
          : [{ label: 'Report post', icon: <Flag size={18} />, onSelect: () => setDlg('report') },
             { label: `Block ${p.authorName}`, icon: <Ban size={18} />, danger: true, onSelect: () => setDlg('block') }]} />
      </header>
      {p.media ? <SocialImage url={media} settled={settled} alt={`Photo from ${who}`} /> : <div className="text-only">{p.caption}</div>}
      <div className="post-actions">
        <button type="button" className="icon-btn" aria-pressed={p.likedByMe} aria-label={p.likedByMe ? 'Unlike post' : 'Like post'} onClick={toggleLike}>
          <Heart size={24} className={p.likedByMe ? 'liked' : ''} fill={p.likedByMe ? 'currentColor' : 'none'} aria-hidden />
        </button>
        <span className="count" aria-label={`${p.likeCount} likes`}>{p.likeCount}</span>
        <button type="button" className="icon-btn" aria-expanded={open} aria-label={`Comments (${p.commentCount})`} onClick={() => setOpen((v) => !v)}><MessageCircle size={24} aria-hidden /></button>
        <span className="count" aria-label={`${p.commentCount} comments`}>{p.commentCount}</span>
        <span className="grow" />
        <button type="button" className="icon-btn" aria-pressed={p.savedByMe} aria-label={p.savedByMe ? 'Remove from saved' : 'Save post'} onClick={toggleSave}>
          <Bookmark size={24} fill={p.savedByMe ? 'currentColor' : 'none'} aria-hidden />
        </button>
      </div>
      <div className="post-body">
        {p.media && p.caption && <>
          <p className={`caption ${long && !expanded ? 'clamp' : ''}`}><b>{who}</b> {p.caption}</p>
          {long && <button type="button" className="link-btn" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>{expanded ? 'Show less' : 'Show more'}</button>}
        </>}
        {!open && p.commentCount > 0 && <button type="button" className="link-btn" onClick={() => setOpen(true)}>View {p.commentCount} {p.commentCount === 1 ? 'comment' : 'comments'}</button>}
        {open && <Comments post={p} dispatch={dispatch} />}
      </div>
      <ConfirmDialog open={dlg === 'delete'} onClose={() => setDlg(null)} title="Delete this post?" confirmLabel="Delete"
        body="The post, its photo, likes, comments and notifications are removed for good." onConfirm={() => void del()} />
      <ReportDialog open={dlg === 'report'} onClose={() => setDlg(null)} target="post" targetId={p.id} subject="post" />
      <BlockDialog open={dlg === 'block'} onClose={() => setDlg(null)} name={p.authorName}
        onBlocked={async () => { await api.block(p.authorId); dispatch({ type: 'removeAuthor', authorId: p.authorId }); toast({ text: `${p.authorName} is blocked.` }); }} />
    </article>
  );
}

type Row = CommentView;

function Comments({ post, dispatch }: { post: PostView; dispatch: (a: PostAction) => void }) {
  const { api } = useSocial();
  const toast = useToast();
  const list = usePageList<Row>((c) => api.comments(post.id, c), post.id);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lock = useRef(false);
  const [reporting, setReporting] = useState<string | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lock.current) return;
    const bad = validateComment(draft);
    if (bad) { setErr(bad); return; }
    lock.current = true; setSending(true); setErr(null);
    try {
      const id = await api.addComment(post.id, draft);
      const mine: Row = { id, authorId: '', authorName: 'You', body: draft.trim(), createdAt: new Date().toISOString(), canDelete: true, cursor: `local-${id}` };
      list.setItems((cur) => [...cur, mine]);
      dispatch({ type: 'comments/delta', id: post.id, delta: 1 });
      setDraft('');
    } catch (e2) { setErr(failText(e2, 'Couldn’t post your comment. Your text is still here.')); }
    finally { lock.current = false; setSending(false); }
  };

  const remove = async (c: Row) => {
    const before = list.items;
    list.setItems((cur) => cur.filter((x) => x.id !== c.id)); // optimistic
    dispatch({ type: 'comments/delta', id: post.id, delta: -1 });
    try { await api.deleteComment(c.id); }
    catch (e) {
      list.setItems(before); dispatch({ type: 'comments/delta', id: post.id, delta: 1 });
      toast({ text: failText(e, 'Couldn’t delete that comment.'), tone: 'error', action: { label: 'Retry', run: () => void remove(c) } });
    }
  };

  return (
    <div className="comments" aria-label="Comments">
      {list.status === 'loading' && <p className="subtle" role="status">Loading comments…</p>}
      {list.status === 'error' && <Notice tone="error" action={<button type="button" className="btn btn-secondary btn-sm" onClick={list.reload}>Try again</button>}>{list.error}</Notice>}
      {list.status === 'ready' && list.items.length === 0 && <p className="subtle">No comments yet. Be the first.</p>}
      {list.items.map((c) => (
        <div key={c.id} className="comment row" style={{ alignItems: 'flex-start', gap: 8 }}>
          <p className="break grow" style={{ margin: 0 }}><b>{c.authorName}</b>{c.body}<span className="subtle"> {postedAgo(c.createdAt)}</span></p>
          {c.canDelete
            ? <button type="button" className="icon-btn" aria-label={`Delete comment by ${c.authorName}`} onClick={() => void remove(c)}><Trash2 size={18} aria-hidden /></button>
            : <button type="button" className="icon-btn" aria-label={`Report comment by ${c.authorName}`} onClick={() => setReporting(c.id)}><Flag size={18} aria-hidden /></button>}
        </div>
      ))}
      <LoadMore visible={!!list.next} state={list.more} error={list.error} onMore={list.loadMore} />
      <form className="comment-form" onSubmit={(e) => void send(e)} noValidate>
        <label className="sr-only" htmlFor={`cmt-${post.id}`}>Add a comment</label>
        <input id={`cmt-${post.id}`} className="input" value={draft} onChange={(e) => { setDraft(e.target.value); setErr(null); }} placeholder="Add a comment" autoComplete="off" aria-invalid={!!err} />
        <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim() || charCount(draft.trim()) > SOCIAL_RULES.commentMax} aria-label="Post comment"><Send size={16} aria-hidden />Post</button>
      </form>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {err ? <p className="field-error" role="alert">{err}</p> : <span />}
        <Counter value={charCount(draft)} max={SOCIAL_RULES.commentMax} />
      </div>
      {reporting && <ReportDialog open onClose={() => setReporting(null)} target="comment" targetId={reporting} subject="comment" />}
    </div>
  );
}
