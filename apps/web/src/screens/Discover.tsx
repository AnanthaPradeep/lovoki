import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, X, SlidersHorizontal, MapPin, Briefcase, Compass, ShieldCheck, EyeOff, Info, MoreHorizontal } from 'lucide-react';
import { INTENTION_LABEL, discoverQueue, filtersActive, undecidedCount, DEFAULT_FILTERS, type Profile } from '@lovoki/core';
import { store, useAppState } from '../store';
import { Avatar, EmptyState, Menu, Notice, Photo, useToast } from '../ui';
import { FiltersDialog, MatchDialog, useSafety } from '../components/dialogs';

export function Discover() {
  const s = useAppState();
  const queue = useMemo(() => discoverQueue(s), [s]);
  const remaining = useMemo(() => undecidedCount(s), [s]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [match, setMatch] = useState<Profile | null>(null);
  const active = filtersActive(s.filters);
  const activeCount = (s.filters.intentions.length ? 1 : 0) + (s.filters.interests.length ? 1 : 0) +
    (s.filters.ageMin !== 18 || s.filters.ageMax !== 60 ? 1 : 0) + (s.filters.maxDistanceKm !== 100 ? 1 : 0);
  const current = queue[0];

  return (
    <div className="page-wide">
      <section aria-labelledby="discover-title">
        <div className="page-head">
          <div><h1 id="discover-title">Discover</h1><p className="sub">{queue.length} {queue.length === 1 ? 'person' : 'people'} to meet</p></div>
          <button className="btn btn-secondary" onClick={() => setFiltersOpen(true)} aria-label={active ? `Filters, ${activeCount} active` : 'Filters'}>
            <SlidersHorizontal size={18} aria-hidden />Filters{active && <span className="badge" aria-hidden>{activeCount}</span>}
          </button>
        </div>
        {!s.privacy.datingDiscoverable && (
          <div style={{ marginBottom: 16 }}><Notice tone="warning" action={<Link to="/settings" className="btn btn-secondary btn-sm">Settings</Link>}>
            You’re hidden from Discover. You can still browse, but new people won’t see you.</Notice></div>
        )}
        {current ? (
          <DiscoverCard key={current.id} profile={current} onMatch={setMatch} />
        ) : remaining > 0 && active ? (
          <EmptyState icon={<SlidersHorizontal size={28} />} title="No one matches these filters"
            body={`${remaining} ${remaining === 1 ? 'person is' : 'people are'} outside your current filters. Widen them to see more.`}
            action={<div className="row"><button className="btn btn-primary" onClick={() => store.setFilters({ ...DEFAULT_FILTERS })}>Reset filters</button><button className="btn btn-secondary" onClick={() => setFiltersOpen(true)}>Adjust</button></div>} />
        ) : (
          <EmptyState icon={<Compass size={28} />} title="You’ve met everyone for now"
            body="New people join every day. In the meantime, see what people are sharing in the feed."
            action={<div className="row"><Link to="/feed" className="btn btn-primary">Go to feed</Link><button className="btn btn-secondary" onClick={() => store.resetDemo()}>Reset demo</button></div>} />
        )}
        <div className="narrow-only" style={{ marginTop: 24 }}><Notice><b>Demo:</b> Maya, Kofi and Priya are scripted to like you back.</Notice></div>
      </section>
      <aside className="rail" aria-label="Discover details"><Rail onFilters={() => setFiltersOpen(true)} /></aside>
      <FiltersDialog open={filtersOpen} onClose={() => setFiltersOpen(false)} />
      <MatchDialog profile={match} onClose={() => setMatch(null)} />
    </div>
  );
}

function DiscoverCard({ profile: p, onMatch }: { profile: Profile; onMatch: (p: Profile) => void }) {
  const toast = useToast();
  const [idx, setIdx] = useState(0);
  const [leaving, setLeaving] = useState<'left' | 'right' | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; dx: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const safety = useSafety(p);
  const prompt = p.prompts[0];
  const first = p.name.split(' ')[0];

  const animate = (dir: 'left' | 'right', then: () => void) => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setLeaving(dir); setTimeout(then, reduced ? 0 : 200);
  };
  const pass = () => animate('left', () => store.pass(p.id));
  const like = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { matched } = await store.like(p.id);
      if (matched) onMatch(p); else toast({ text: `You liked ${first}. They’ll only know if they like you too.` });
    } catch {
      setBusy(false);
      toast({ text: `Couldn’t send your like to ${first}.`, tone: 'error', action: { label: 'Retry', run: like } });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, dialog, [role="menu"]') || document.querySelector('dialog[open]')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); pass(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); void like(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Swipe is an enhancement; the buttons below are the accessible primary path.
  const onPointerDown = (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') drag.current = { x: e.clientX, dx: 0 }; };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !cardRef.current) return;
    drag.current.dx = e.clientX - drag.current.x;
    cardRef.current.style.transform = `translateX(${drag.current.dx}px) rotate(${drag.current.dx / 40}deg)`;
  };
  const onPointerUp = () => {
    const d = drag.current; drag.current = null;
    if (cardRef.current) cardRef.current.style.transform = '';
    if (!d) return;
    if (d.dx > 90) void like(); else if (d.dx < -90) pass();
  };

  return (
    <article className={`discover-card ${leaving ? `leaving-${leaving}` : ''}`} aria-label={`${p.name}, ${p.age}`} ref={cardRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <div className="dc-photo">
        <Photo photo={p.photos[idx]} />
        {p.photos.length > 1 && <>
          <div className="dc-pager" aria-hidden>{p.photos.map((ph, i) => <span key={ph.id} data-on={i === idx} />)}</div>
          <button className="dc-zone prev" aria-label="Previous photo" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))} />
          <button className="dc-zone next" aria-label="Next photo" disabled={idx === p.photos.length - 1} onClick={() => setIdx((i) => Math.min(p.photos.length - 1, i + 1))} />
        </>}
      </div>
      {prompt && (
        <div className="dc-note">
          <div className="q">{prompt.question}</div>
          <blockquote>{prompt.answer}</blockquote>
        </div>
      )}
      <div className="dc-body">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <h2 className="dc-name grow">{p.name}<span className="age">, {p.age}</span></h2>
          <Menu label={`More options for ${first}`} icon={<MoreHorizontal size={22} />} items={safety.items} />
        </div>
        <div className="dc-meta">
          <span><MapPin size={16} aria-hidden />{p.area}, about {p.distanceKm} km</span>
          {p.work && <span><Briefcase size={16} aria-hidden />{p.work}</span>}
          {p.verification === 'demo-photo-check' && <span><ShieldCheck size={16} aria-hidden />Photo check (demo)</span>}
        </div>
        <div className="chips">
          <span className="chip chip-dating">{INTENTION_LABEL[p.intention]}</span>
          {p.interests.map((i) => <span className="chip" key={i}>{i}</span>)}
        </div>
      </div>
      <div className="dc-actions">
        <button className="round" onClick={pass} aria-label={`Pass on ${first}`} disabled={busy}><X size={28} aria-hidden /></button>
        <Link to={`/u/${p.id}`} className="btn btn-secondary">View profile</Link>
        <button className="round like" onClick={like} aria-label={`Like ${first}`} disabled={busy}>{busy ? <span className="spinner" aria-hidden /> : <Heart size={30} fill="currentColor" aria-hidden />}</button>
      </div>
      <p className="subtle kbd-hint">Keyboard: <kbd>←</kbd> pass, <kbd>→</kbd> like</p>
      {safety.dialogs}
    </article>
  );
}

function Rail({ onFilters }: { onFilters: () => void }) {
  const s = useAppState();
  const recent = s.matches.slice(0, 4).map((m) => s.profiles[m.profileId]!).filter(Boolean);
  return (
    <>
      <div className="card card-pad stack">
        <h2>Recent matches</h2>
        {recent.length ? (
          <div className="match-strip">{recent.map((p) => (
            <Link key={p.id} to={`/messages/${p.id}`}><span className="ring"><Avatar profile={p} size={56} /></span><span className="truncate" style={{ maxWidth: 72 }}>{p.name.split(' ')[0]}</span></Link>
          ))}</div>
        ) : <p className="muted">When you and someone like each other, they’ll appear here.</p>}
      </div>
      <div className="card card-pad stack">
        <h2>How matching works</h2>
        <p className="muted">Likes are private. A match only happens when you both like each other, and only matches can message. Following someone is separate and never creates a match.</p>
        <button className="btn btn-secondary btn-sm" onClick={onFilters} style={{ justifySelf: 'start' }}><SlidersHorizontal size={16} aria-hidden />Adjust filters</button>
      </div>
      <Notice><b>Demo:</b> Maya, Kofi and Priya are scripted to like you back so you can try a mutual match.</Notice>
      {!s.privacy.datingDiscoverable && <Notice tone="warning"><EyeOff size={14} aria-hidden /> Hidden from Discover</Notice>}
      <p className="subtle"><Info size={12} aria-hidden /> All people here are synthetic adults. Photos are generated artwork.</p>
    </>
  );
}
