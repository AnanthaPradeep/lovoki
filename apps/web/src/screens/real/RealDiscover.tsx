import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Compass, Flag, Heart, Info, MoreHorizontal, PauseCircle, SlidersHorizontal, X } from 'lucide-react';
import { DatingFailure, SubmitGuard, deckReducer, emptyDeck, emptyReason, type DatingCard, type DatingStatus } from '@lovoki/core';
import { EmptyState, Menu, Notice, useToast } from '../../ui';
import { useTitle } from '../../ui/useTitle';
import { useReadyAccount } from '../../account/AccountProvider';
import { useMediaUrls, useSocial } from '../../social/SocialProvider';
import { LoadError, PostSkeletons } from '../../social/parts';
import { NotificationsLink } from '../../social/PostList';
import { BlockDialog, ReportDialog } from '../../social/safety';
import { DatingCardView, cardRefs } from '../../dating/DatingCardView';
import { FiltersDialog, MatchDialog } from '../../dating/DatingDialogs';

const msg = (e: unknown, fallback: string) => (e instanceof DatingFailure ? e.message : fallback);

export function RealDiscover() {
  useTitle('Discover');
  const { dating, api: social, refreshUnread } = useSocial();
  const { account } = useReadyAccount();
  const toast = useToast();
  const [deck, dispatch] = useReducer(deckReducer, undefined, emptyDeck);
  const [status, setStatus] = useState<DatingStatus | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dlg, setDlg] = useState<null | 'report' | 'block'>(null);
  const seq = useRef(0);
  const guard = useRef(new SubmitGuard()).current;

  const load = useCallback(() => {
    const my = ++seq.current; setPhase('loading'); setError(null);
    dating.status().then(async (st) => {
      if (my !== seq.current) return;
      setStatus(st);
      if (st.paused || !st.hasGender) { dispatch({ type: 'replace', page: { items: [], next: null } }); setPhase('ready'); return; }
      const page = await dating.discover(null);
      if (my !== seq.current) return;
      dispatch({ type: 'replace', page }); setPhase('ready');
    }).catch((e) => { if (my === seq.current) { setError(msg(e, 'Couldn’t load Discover.')); setPhase('error'); } });
  }, [dating]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bumping the counter on cleanup invalidates in-flight responses
  useEffect(() => { load(); return () => { seq.current++; }; }, [load]);

  // Keep a few cards ahead so the next one is ready the moment you decide.
  useEffect(() => {
    if (phase !== 'ready' || more || !deck.next || deck.items.length > 3) return;
    const my = seq.current; setMore(true);
    dating.discover(deck.next).then((page) => { if (my === seq.current) dispatch({ type: 'append', page }); }).catch(() => undefined).finally(() => setMore(false));
  }, [deck.items.length, deck.next, phase, more, dating]);

  const current: DatingCard | undefined = deck.items[0];
  const refs = useMemo(() => [...cardRefs(current), ...cardRefs(deck.items[1], false)], [current, deck.items]);
  const { urls, settled } = useMediaUrls(refs);
  const limitReached = !!status && status.likesLeft <= 0;

  const act = useCallback((card: DatingCard, action: 'like' | 'pass') => {
    if (action === 'like' && limitReached) return;
    if (guard.isBusy(card.id)) return;
    dispatch({ type: 'act/start', id: card.id, action });
    void guard.run(card.id, async () => {
      try {
        if (action === 'pass') { await dating.pass(card.id); dispatch({ type: 'act/ok', id: card.id }); return; }
        const result = await dating.like(card.id);
        dispatch({ type: 'act/ok', id: card.id, result });
        setStatus((s) => (s ? { ...s, likesLeft: Math.max(0, s.likesLeft - 1) } : s));
        if (result.matched) refreshUnread();
        else toast({ text: `You liked ${card.displayName}. They’ll only know if they like you too.` });
      } catch (e) {
        dispatch({ type: 'act/fail', id: card.id });
        if (e instanceof DatingFailure && e.code === 'daily_limit') { setStatus((s) => (s ? { ...s, likesLeft: 0 } : s)); return; }
        if (e instanceof DatingFailure && e.code === 'paused') { setStatus((s) => (s ? { ...s, paused: true } : s)); toast({ text: e.message, tone: 'error' }); return; }
        toast({ text: msg(e, action === 'like' ? `Couldn’t send your like to ${card.displayName}.` : 'Couldn’t pass. Try again.'), tone: 'error', action: { label: 'Retry', run: () => act(card, action) } });
      }
    });
  }, [dating, guard, limitReached, refreshUnread, toast]);

  // Keyboard: arrows decide, unless you are typing or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!current || t.closest('input, textarea, select, dialog, [role="menu"]') || document.querySelector('dialog[open]')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); act(current, 'pass'); }
      if (e.key === 'ArrowRight') { e.preventDefault(); act(current, 'like'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, act]);

  // Swipe is an enhancement only; the buttons are the accessible primary path.
  const drag = useRef<{ x: number; dx: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const onDown = (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') drag.current = { x: e.clientX, dx: 0 }; };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !cardRef.current) return;
    drag.current.dx = e.clientX - drag.current.x; cardRef.current.style.transform = `translateX(${drag.current.dx}px) rotate(${drag.current.dx / 40}deg)`;
  };
  const onUp = () => {
    const d = drag.current; drag.current = null; if (cardRef.current) cardRef.current.style.transform = '';
    if (d && current) { if (d.dx > 90) act(current, 'like'); else if (d.dx < -90) act(current, 'pass'); }
  };

  // 18 to 60 is what onboarding saves and 18 to 99 is "anyone": neither counts as an active age filter.
  const defaultAge = account.ageMin === 18 && (account.ageMax === 60 || account.ageMax === 99);
  const hasFilters = account.filterIntentions.length > 0 || account.filterInterests.length > 0 || account.maxDistanceKm !== null || !defaultAge;
  const activeCount = (account.filterIntentions.length ? 1 : 0) + (account.filterInterests.length ? 1 : 0) + (account.maxDistanceKm !== null ? 1 : 0) + (!defaultAge ? 1 : 0);
  const empty = emptyReason(status, hasFilters);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Discover</h1><p className="sub">People who want to meet someone like you</p></div>
        <div className="row">
          <NotificationsLink />
          <button type="button" className="btn btn-secondary" onClick={() => setFiltersOpen(true)} aria-label={activeCount ? `Filters, ${activeCount} active` : 'Filters'}>
            <SlidersHorizontal size={18} aria-hidden />Filters{activeCount > 0 && <span className="badge" aria-hidden>{activeCount}</span>}
          </button>
        </div>
      </div>

      {status?.paused && <div style={{ marginBottom: 16 }}><Notice tone="warning" action={<Link to="/settings" className="btn btn-secondary btn-sm">Settings</Link>}>You’re paused: hidden from Discover, and you can’t like anyone. Your matches stay.</Notice></div>}
      {status && !status.paused && !status.hasPlace && status.hasGender && <div style={{ marginBottom: 16 }}><Notice action={<Link to="/settings" className="btn btn-secondary btn-sm">Add city</Link>}>Add your city to see approximate distances and use the distance filter. Until then, distance isn’t applied.</Notice></div>}
      {limitReached && !status?.paused && current && <div style={{ marginBottom: 16 }} data-testid="limit-banner"><Notice>You’ve reached today’s limit of {status?.dailyCap} likes. You can keep looking and passing, and likes come back gradually over 24 hours.</Notice></div>}

      {phase === 'loading' && <PostSkeletons count={1} />}
      {phase === 'error' && <LoadError message={error ?? 'Couldn’t load Discover.'} onRetry={load} />}
      {phase === 'ready' && current && (
        <div ref={cardRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <DatingCardView key={current.id} card={current} urls={urls} settled={settled}
            menu={<Menu label={`More options for ${current.displayName}`} icon={<MoreHorizontal size={22} />} items={[
              { label: 'Report profile', icon: <Flag size={18} />, onSelect: () => setDlg('report') },
              { label: `Block ${current.displayName}`, icon: <Ban size={18} />, danger: true, onSelect: () => setDlg('block') }]} />}>
            <div className="dc-actions">
              <button type="button" className="round" onClick={() => act(current, 'pass')} aria-label={`Pass on ${current.displayName}`}><X size={28} aria-hidden /></button>
              <Link to={`/discover/${current.id}`} className="btn btn-secondary">View profile</Link>
              <button type="button" className="round like" onClick={() => act(current, 'like')} aria-label={`Like ${current.displayName}`} disabled={limitReached} title={limitReached ? 'You’ve reached today’s limit' : undefined}><Heart size={30} fill="currentColor" aria-hidden /></button>
            </div>
            <p className="subtle kbd-hint">Keyboard: <kbd>←</kbd> pass, <kbd>→</kbd> like. Likes are private until you both like each other.</p>
          </DatingCardView>
          {dlg === 'report' && <ReportDialog open onClose={() => setDlg(null)} target="profile" targetId={current.userId} subject="profile" />}
          {dlg === 'block' && <BlockDialog open onClose={() => setDlg(null)} name={current.displayName}
            onBlocked={async () => { await social.block(current.userId); dispatch({ type: 'act/start', id: current.id, action: 'pass' }); dispatch({ type: 'act/ok', id: current.id }); toast({ text: `${current.displayName} is blocked.` }); }} />}
        </div>
      )}
      {phase === 'ready' && !current && (more || deck.next
        ? <PostSkeletons count={1} />
        : <EmptyState icon={empty.reason === 'paused' ? <PauseCircle size={28} /> : empty.reason === 'no-one-new' ? <Compass size={28} /> : <Info size={28} />} title={empty.title} body={empty.body}
            action={empty.reason === 'paused' || empty.reason === 'needs-gender' ? <Link to="/settings" className="btn btn-primary">Open settings</Link>
              : <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center' }}><button type="button" className="btn btn-primary" onClick={() => setFiltersOpen(true)}>Adjust filters</button><button type="button" className="btn btn-secondary" onClick={load}>Check again</button></div>} />)}

      <MatchDialog card={deck.matched?.card ?? null} onClose={() => dispatch({ type: 'dismissMatch' })} />
      <FiltersDialog open={filtersOpen} onClose={() => setFiltersOpen(false)} hasPlace={!!status?.hasPlace} onSaved={load} />
    </div>
  );
}
