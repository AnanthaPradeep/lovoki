import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, SearchX } from 'lucide-react';
import { SocialFailure, type PersonCard } from '@lovoki/core';
import { EmptyState } from '../../ui';
import { useTitle } from '../../ui/useTitle';
import { LoadError, LockMark, PersonAvatar, SampleBadge } from '../../social/parts';
import { useMediaUrls, useSocial } from '../../social/SocialProvider';
import { useHideSamples } from '../../social/devTools';

type Status = 'idle' | 'loading' | 'ready' | 'error';
const MIN = 2;

/** Search people by @handle or name. A combobox: type, arrow through the results, Enter opens. Private accounts show a lock. */
export function RealSearch() {
  useTitle('Search');
  const { api } = useSocial();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const hideSamples = useHideSamples();
  const initial = params.get('q') ?? '';
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<PersonCard[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState('');
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(true);
  const seq = useRef(0);
  const listId = useId();
  const term = q.trim();
  const long = [...term].length >= MIN;

  useEffect(() => {
    if (!long) { seq.current++; setResults([]); setStatus('idle'); setActive(-1); return; }
    const my = ++seq.current; setStatus('loading');
    const t = setTimeout(() => {
      api.search(term).then((r) => { if (my === seq.current) { setResults(r); setStatus('ready'); setActive(-1); } })
        .catch((e) => { if (my === seq.current) { setErr(e instanceof SocialFailure ? e.message : 'Search didn’t work. Try again.'); setStatus('error'); } });
    }, 250);
    return () => clearTimeout(t);
  }, [api, term, long]);

  useEffect(() => { const next = new URLSearchParams(params); if (term) next.set('q', term); else next.delete('q'); if (next.toString() !== params.toString()) setParams(next, { replace: true }); }, [term]); // eslint-disable-line react-hooks/exhaustive-deps -- mirror the query into the URL only

  const shown = useMemo(() => results.filter((c) => !(hideSamples && c.isSample)), [results, hideSamples]);
  const { urls } = useMediaUrls(useMemo(() => shown.flatMap((c) => (c.photoPath ? [{ bucket: 'profile-photos' as const, path: c.photoPath }] : [])), [shown]));
  const go = (c: PersonCard) => nav(c.username ? `/@${c.username}` : `/u/${c.userId}`);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => (shown.length ? (a + 1) % shown.length : -1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive((a) => (shown.length ? (a <= 0 ? shown.length - 1 : a - 1) : -1)); }
    else if (e.key === 'Enter' && active >= 0 && shown[active]) { e.preventDefault(); go(shown[active]!); }
    else if (e.key === 'Escape') { if (open && shown.length) { e.preventDefault(); setOpen(false); setActive(-1); } else setQ(''); }
  };

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>Search</h1><p className="sub">Find people by @username or name</p></div></div>
      <div className="field">
        <label htmlFor="people-search">Search people</label>
        <div style={{ position: 'relative' }}>
          <Search size={18} aria-hidden style={{ position: 'absolute', left: 14, top: 15, color: 'var(--c-text-muted)' }} />
          <input id="people-search" className="input" style={{ paddingLeft: 40 }} type="search" role="combobox" aria-expanded={open && shown.length > 0} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={40}
            placeholder="Try a name or @username" value={q} onChange={(e) => { setQ(e.target.value.replace(/^@/, '')); setOpen(true); }} onKeyDown={onKey} />
        </div>
        <span className="hint" id={`${listId}-hint`}>Type at least {MIN} characters. Private accounts appear with a lock; you’ll see only their name and handle.</span>
      </div>
      <div aria-live="polite" className="sr-only" data-testid="search-status">{status === 'loading' ? 'Searching' : status === 'ready' ? `${shown.length} ${shown.length === 1 ? 'result' : 'results'}` : ''}</div>
      {status === 'error' && <LoadError message={err} onRetry={() => setQ((x) => `${x} `.trimEnd())} />}
      {status === 'idle' && <p className="subtle" data-testid="search-idle">{term ? `Keep typing: at least ${MIN} characters.` : 'Results show up here as you type.'}</p>}
      {status === 'loading' && <div className="skeleton" style={{ height: 64 }} aria-busy="true" aria-label="Searching" />}
      {status === 'ready' && shown.length === 0 && <EmptyState icon={<SearchX size={28} />} title="No one found" body={`Nobody matches “${term}”. Check the spelling, or try just the start of a name or @username.`} />}
      <ul id={listId} role="listbox" aria-label="Search results" className="search-results" hidden={!(open && shown.length > 0)}>
        {shown.map((c, i) => (
          <li key={c.userId} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(c)}>
            <PersonAvatar name={c.displayName} url={c.photoPath ? urls.get(c.photoPath) : undefined} size={44} crop={c.avatarCrop} blurhash={c.avatarBlurhash} locked={c.isPrivate} />
            <span className="grow" style={{ minWidth: 0, display: 'grid' }}>
              <span className="truncate" style={{ fontWeight: 700 }}>{c.username ? `@${c.username}` : c.displayName}</span>
              <span className="subtle truncate">{c.displayName}</span>
            </span>
            {c.isPrivate && <LockMark />}{c.isSample && <SampleBadge />}
          </li>
        ))}
      </ul>
    </div>
  );
}
