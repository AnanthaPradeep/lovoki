import { useEffect, useId, useRef, useState } from 'react';
import { Crosshair, MapPin, X } from 'lucide-react';
import type { AccountApi, PlaceHit } from '@lovoki/core';
import { FieldError, Notice } from '../ui';

/**
 * Pick your city by typing its name. An accessible combobox: arrow keys move, Enter picks, Escape closes.
 * "Use my current location" asks the browser ONLY after you click it. The one point it returns is sent to the server to find the nearest
 * cities and is not stored; only the place you choose is saved. No coordinates ever come back to this screen.
 */
export function PlacePicker({ api, value, onChange, error, label = 'Your city' }: { api: Pick<AccountApi, 'searchPlaces' | 'nearestPlaces'>; value: PlaceHit | null; onChange: (p: PlaceHit | null) => void; error?: string; label?: string }) {
  const id = useId();
  const [text, setText] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'info' | 'error' | 'warning'; text: string } | null>(null);
  const seq = useRef(0);
  const box = useRef<HTMLInputElement>(null);
  const list = `${id}-list`;

  // Debounced search: 250 ms after the last keystroke, and a late answer to an older query is ignored.
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) { setHits([]); setOpen(false); return; }
    const my = ++seq.current;
    const t = setTimeout(() => {
      api.searchPlaces(q).then((r) => { if (my === seq.current) { setHits(r); setOpen(true); setActive(r.length ? 0 : -1); setNote(r.length ? null : { tone: 'info', text: 'No city with that name. We only list larger cities. Try a nearby one.' }); } })
        .catch(() => { if (my === seq.current) setNote({ tone: 'error', text: 'Couldn’t search just now. Try again.' }); });
    }, 250);
    return () => clearTimeout(t);
  }, [text, api]);

  const pick = (p: PlaceHit) => { onChange(p); setText(''); setHits([]); setOpen(false); setNote(null); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (hits.length) { setOpen(true); setActive((a) => (a + 1) % hits.length); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (hits.length) setActive((a) => (a <= 0 ? hits.length - 1 : a - 1)); }
    else if (e.key === 'Enter' && open && active >= 0 && hits[active]) { e.preventDefault(); pick(hits[active]!); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  };

  const useLocation = () => {
    setNote(null);
    if (!('geolocation' in navigator)) { setNote({ tone: 'warning', text: 'Your browser can’t share a location. Search for your city instead.' }); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        api.nearestPlaces(pos.coords.latitude, pos.coords.longitude).then((r) => {
          setHits(r); setOpen(r.length > 0); setActive(0);
          setNote({ tone: 'info', text: r.length ? 'These are the nearest cities. Pick yours. Only the city you pick is saved, never your position.' : 'We couldn’t match your location to a city. Search for it instead.' });
        }).catch(() => setNote({ tone: 'error', text: 'Couldn’t look that up. Search for your city instead.' })).finally(() => setBusy(false));
      },
      (err) => {
        setBusy(false);
        setNote({ tone: 'warning', text: err.code === 1 ? 'No problem: location stays off. Search for your city instead.' : 'Couldn’t get your location. Search for your city instead.' });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  };

  return (
    <div className="field" data-invalid={!!error}>
      <label htmlFor={`${id}-in`}>{label}</label>
      {value && (
        <div className="row chip chip-dating" style={{ justifySelf: 'start', gap: 8 }} data-testid="place-chosen">
          <MapPin size={16} aria-hidden /><span className="break">{value.label}</span>
          <button type="button" className="icon-btn" style={{ width: 32, height: 32 }} aria-label={`Remove ${value.label}`} onClick={() => { onChange(null); setTimeout(() => box.current?.focus(), 0); }}><X size={16} aria-hidden /></button>
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <input ref={box} id={`${id}-in`} className="input" role="combobox" aria-expanded={open} aria-controls={list} aria-autocomplete="list" aria-invalid={!!error}
          aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined} autoComplete="off" spellCheck={false} placeholder={value ? 'Search to change your city' : 'Start typing a city, for example Kochi'}
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={() => setTimeout(() => setOpen(false), 120)} onFocus={() => hits.length && setOpen(true)} />
        {open && hits.length > 0 && (
          <ul id={list} role="listbox" aria-label="Cities" className="card" style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, top: 'calc(100% + 4px)', margin: 0, padding: 4, listStyle: 'none', maxHeight: 280, overflowY: 'auto' }}>
            {hits.map((h, i) => (
              <li key={`${h.id}-${i}`} id={`${id}-opt-${i}`} role="option" aria-selected={i === active} data-active={i === active} onMouseDown={(e) => { e.preventDefault(); pick(h); }} onMouseEnter={() => setActive(i)}
                style={{ minHeight: 44, display: 'flex', alignItems: 'center', padding: '0 12px', borderRadius: 8, cursor: 'pointer', background: i === active ? 'var(--c-primary-soft)' : undefined, overflowWrap: 'anywhere' }}>{h.label}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={useLocation} disabled={busy} aria-busy={busy}><Crosshair size={16} aria-hidden />{busy ? 'Looking…' : 'Use my current location'}</button>
        <span className="hint">Optional. Your browser asks only when you click.</span>
      </div>
      <span className="hint">We never show your city on a map or keep your exact position. Your place is rounded to about 5 km, and other people only see a distance range.</span>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <FieldError id={`${id}-err`}>{error}</FieldError>
    </div>
  );
}
