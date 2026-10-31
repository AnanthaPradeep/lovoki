import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, MoreHorizontal, Send, Check, CheckCheck, AlertCircle, Lock } from 'lucide-react';
import { canMessage, clockTime, conversationList, relativeTime, LIMITS, type Message } from '@lovoki/core';
import { store, useAppState } from '../store';
import { Avatar, EmptyState, Menu, Notice } from '../ui';
import { useSafety } from '../components/dialogs';

export function Messages() {
  const s = useAppState();
  const list = useMemo(() => conversationList(s), [s]);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Messages</h1><p className="sub">Conversations open after a mutual match</p></div></div>
      {list.length ? (
        <div className="card card-pad list">
          {list.map(({ profile: p, conversation: c, last }) => (
            <Link key={p.id} to={`/messages/${p.id}`} className="list-row" data-unread={c.unread > 0}>
              <Avatar profile={p} size={52} />
              <div className="grow">
                <div className="row" style={{ gap: 8 }}><span className="name truncate grow">{p.name}</span><span className="subtle">{last ? relativeTime(last.createdAt) : 'New'}</span></div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="preview truncate grow">{last ? `${last.fromMe ? 'You: ' : ''}${last.text}` : `You matched with ${p.name.split(' ')[0]}. Say hello.`}</span>
                  {c.unread > 0 && <span className="badge" aria-label={`${c.unread} unread`}>{c.unread}</span>}
                  {last?.fromMe && last.delivery === 'failed' && <AlertCircle size={16} className="liked" aria-label="Not sent" />}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : <EmptyState icon={<MessageCircle size={28} />} title="No conversations yet" body="Match with someone in Discover to start talking."
        action={<Link to="/discover" className="btn btn-primary">Go to Discover</Link>} />}
    </div>
  );
}

const dayLabel = (t: number) => {
  const d = new Date(t), today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};

export function Chat() {
  const { id = '' } = useParams();
  const s = useAppState();
  const nav = useNavigate();
  const p = s.profiles[id];
  const conv = s.conversations[id];
  const allowed = canMessage(s, id);
  const safety = useSafety(p, { afterBlock: () => nav('/messages'), afterUnmatch: () => nav('/messages') });
  const [text, setText] = useState('');
  const thread = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (allowed) store.markRead(id); }, [id, allowed, conv?.messages.length]);
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight }); }, [conv?.messages.length]);
  useEffect(() => { const el = input.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }, [text]);

  if (!p || !allowed || !conv) {
    return <div className="page"><EmptyState icon={<Lock size={28} />} title="This conversation isn’t available"
      body="Dating messages unlock after a mutual match. Following someone doesn’t open a conversation."
      action={<Link to="/messages" className="btn btn-primary">Back to messages</Link>} /></div>;
  }
  const first = p.name.split(' ')[0];
  const send = () => { if (!text.trim() || text.length > LIMITS.message) return; void store.sendMessage(id, text); setText(''); input.current?.focus(); };
  const lastMine = [...conv.messages].reverse().find((m) => m.fromMe);

  return (
    <div className="chat">
      <header className="chat-head">
        <Link to="/messages" className="icon-btn" aria-label="Back to messages"><ArrowLeft size={20} /></Link>
        <Link to={`/u/${p.id}`} className="row grow" style={{ minWidth: 0 }}><Avatar profile={p} size={40} /><span className="grow"><b className="truncate" style={{ display: 'block' }}>{p.name}</b><span className="subtle">Matched</span></span></Link>
        <Menu label="Conversation options" icon={<MoreHorizontal size={22} />} items={safety.items} />
      </header>
      <div style={{ paddingTop: 12 }}><Notice>Demo conversation: messages stay on this device and aren’t sent to anyone.</Notice></div>
      <div className="thread" ref={thread} aria-live="polite" aria-label={`Conversation with ${first}`}>
        {conv.messages.length === 0 ? (
          <div className="starter">
            <div className="ring"><Avatar profile={p} size={80} /></div>
            <h2 style={{ fontSize: 'var(--fs-title)' }}>You and {first} matched</h2>
            <p className="muted">Start with something from their profile.</p>
            {p.prompts.slice(0, 2).map((pr) => (
              <button key={pr.question} className="suggest" onClick={() => { setText(`“${pr.answer.slice(0, 60)}${pr.answer.length > 60 ? '…' : ''}” Tell me more.`); input.current?.focus(); }}>
                <span className="subtle">{pr.question}</span><br />{pr.answer}
              </button>
            ))}
          </div>
        ) : conv.messages.map((m, i) => {
          const prev = conv.messages[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {newDay && <div className="day">{dayLabel(m.createdAt)}</div>}
              <div className={`bubble ${m.fromMe ? 'me' : 'them'} ${m.delivery === 'failed' ? 'failed' : ''}`}>{m.text}</div>
              {(m === lastMine || m.delivery === 'failed' || m.delivery === 'sending') ? <DeliveryMeta m={m} onRetry={() => store.retryMessage(id, m.id)} />
                : (!conv.messages[i + 1] || conv.messages[i + 1]!.fromMe !== m.fromMe) && <div className={`bubble-meta ${m.fromMe ? '' : 'them'}`}>{clockTime(m.createdAt)}</div>}
            </div>
          );
        })}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label htmlFor="msg" className="sr-only">Message {first}</label>
        <textarea id="msg" ref={input} rows={1} className="textarea" value={text} placeholder={`Message ${first}`}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="icon-btn send" aria-label="Send message" disabled={!text.trim() || text.length > LIMITS.message}><Send size={20} aria-hidden /></button>
      </form>
      {text.length > LIMITS.message * 0.9 && <div className="counter" data-over={text.length > LIMITS.message}>{text.length}/{LIMITS.message}</div>}
      {safety.dialogs}
    </div>
  );
}

function DeliveryMeta({ m, onRetry }: { m: Message; onRetry: () => void }) {
  if (m.delivery === 'failed') return <div className="bubble-meta err"><AlertCircle size={14} aria-hidden />Not sent<button className="btn btn-secondary btn-sm" onClick={onRetry}>Retry</button></div>;
  const label = { sending: 'Sending…', sent: 'Sent', delivered: 'Delivered', read: 'Read' }[m.delivery];
  const Icon = m.delivery === 'read' ? CheckCheck : Check;
  return <div className="bubble-meta">{clockTime(m.createdAt)}{m.delivery === 'sending' ? <span className="spinner" style={{ width: 12, height: 12 }} aria-hidden /> : <Icon size={14} aria-hidden />}{label}</div>;
}
