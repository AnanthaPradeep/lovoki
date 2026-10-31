import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import {
  ALL_INTENTIONS, ALL_INTERESTS, DatingFailure, INTENTION_LABEL, validatePreferences, type DatingCard, type Intention, type MediaRef, type PreferencesInput,
} from '@lovoki/core';
import { Dialog, Notice, useToast } from '../ui';
import { useReadyAccount } from '../account/AccountProvider';
import { useMediaUrls } from '../social/SocialProvider';
import { PersonAvatar } from '../social/parts';

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const DISTANCE_CHOICES = [5, 10, 25, 50, 100];

/** Real match moment. It only opens when the database says both people liked each other. Messaging is honest about being Phase 5. */
export function MatchDialog({ card, onClose }: { card: DatingCard | null; onClose: () => void }) {
  const { account } = useReadyAccount();
  const refs = useMemo<MediaRef[]>(() => [
    ...(card?.photoPaths[0] ? [{ bucket: 'profile-photos' as const, path: card.photoPaths[0] }] : []),
    ...(account.photos[0] ? [{ bucket: 'profile-photos' as const, path: account.photos[0].path }] : []),
  ], [card, account.photos]);
  const { urls } = useMediaUrls(refs);
  return (
    <Dialog open={!!card} onClose={onClose} title="It’s a match"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Keep discovering</button>
        <Link to="/connections?tab=matches" className="btn btn-primary" onClick={onClose}>See your matches</Link></>}>
      {card && <>
        <div className="match-hero">
          <PersonAvatar name={account.displayName || 'You'} url={account.photos[0] ? urls.get(account.photos[0].path) : undefined} size={96} />
          <PersonAvatar name={card.displayName} url={card.photoPaths[0] ? urls.get(card.photoPaths[0]) : undefined} size={96} />
        </div>
        <p style={{ textAlign: 'center', fontSize: 'var(--fs-body-lg)' }}>You and {card.displayName} liked each other.</p>
        <Notice><MessageCircle size={14} aria-hidden style={{ verticalAlign: -2, marginRight: 6 }} />Messaging arrives in Phase 5, so there’s no chat yet. Your match is saved and will be waiting.</Notice>
      </>}
    </Dialog>
  );
}

/** Hard filters (age, distance) are saved to your dating preferences; soft filters (looking for, interests) only narrow your own queue. */
export function FiltersDialog({ open, onClose, hasPlace, onSaved }: { open: boolean; onClose: () => void; hasPlace: boolean; onSaved: () => void }) {
  const { account, api, reload } = useReadyAccount();
  const toast = useToast();
  const [age, setAge] = useState({ min: account.ageMin, max: account.ageMax });
  const [km, setKm] = useState<number | null>(account.maxDistanceKm);
  const [intentions, setIntentions] = useState<string[]>(account.filterIntentions);
  const [interests, setInterests] = useState<string[]>(account.filterInterests);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setAge({ min: account.ageMin, max: account.ageMax }); setKm(account.maxDistanceKm); setIntentions(account.filterIntentions); setInterests(account.filterInterests); setErr(null);
  }, [open, account]);

  const save = async () => {
    if (busy) return;
    const prefs: PreferencesInput = { intention: account.intention, interestedIn: account.interestedIn, ageMin: age.min, ageMax: age.max, maxDistanceKm: km };
    const bad = Object.values(validatePreferences(prefs))[0];
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr(null);
    try {
      await api.savePreferences(prefs);
      await api.saveFilters({ intentions, interests });
      await reload(); onSaved(); onClose();
      toast({ text: 'Filters saved.' });
    } catch (e) { setErr(e instanceof DatingFailure || e instanceof Error ? e.message : 'Couldn’t save your filters.'); }
    finally { setBusy(false); }
  };
  const reset = () => { setAge({ min: 18, max: 99 }); setKm(null); setIntentions([]); setInterests([]); };

  return (
    <Dialog open={open} onClose={onClose} title="Filters"
      footer={<><button type="button" className="btn btn-ghost" onClick={reset}>Reset</button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : 'Save filters'}</button></>}>
      <p className="muted">Age and distance are your dating preferences: they apply when you like people, too. The other filters only shape what you see.</p>
      <div className="field">
        <span className="label" id="f-age">Age range <span className="subtle">(18 to 99)</span></span>
        <div className="range-row" role="group" aria-labelledby="f-age">
          <label><span className="sr-only">Minimum age</span><input className="input" type="number" inputMode="numeric" min={18} max={99} value={Number.isNaN(age.min) ? '' : age.min} onChange={(e) => setAge({ ...age, min: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
          <label><span className="sr-only">Maximum age</span><input className="input" type="number" inputMode="numeric" min={18} max={99} value={Number.isNaN(age.max) ? '' : age.max} onChange={(e) => setAge({ ...age, max: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
        </div>
      </div>
      <div className="field">
        <label htmlFor="f-km">Distance</label>
        <select id="f-km" className="select" value={km ?? ''} onChange={(e) => setKm(e.target.value === '' ? null : Number(e.target.value))} disabled={!hasPlace}>
          <option value="">Any distance</option>
          {DISTANCE_CHOICES.map((d) => <option key={d} value={d}>Within {d} km</option>)}
        </select>
        <span className="hint">{hasPlace ? 'Distances are approximate and only ever shown in ranges.' : 'Add your city in Settings to use distance. Until then everyone is shown regardless of distance.'}</span>
      </div>
      <div className="field">
        <span className="label" id="f-int">Looking for</span>
        <div className="chips" role="group" aria-labelledby="f-int">{ALL_INTENTIONS.map((i) => (
          <button type="button" key={i} className="chip chip-toggle" aria-pressed={intentions.includes(i)} onClick={() => setIntentions(toggle(intentions, i))}>{INTENTION_LABEL[i as Intention]}</button>))}</div>
      </div>
      <div className="field">
        <span className="label" id="f-ints">Shares any of these interests <span className="subtle">({interests.length}/8)</span></span>
        <div className="chips" role="group" aria-labelledby="f-ints">{ALL_INTERESTS.map((i) => (
          <button type="button" key={i} className="chip chip-toggle" aria-pressed={interests.includes(i)} disabled={!interests.includes(i) && interests.length >= 8}
            onClick={() => setInterests(toggle(interests, i))}>{i}</button>))}</div>
      </div>
      {err && <Notice tone="error">{err}</Notice>}
    </Dialog>
  );
}
