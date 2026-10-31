import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, Flag, HeartOff, ImagePlus, Globe, Users, X, MessageCircle } from 'lucide-react';
import {
  ALL_INTENTIONS, ALL_INTERESTS, DEFAULT_FILTERS, INTENTION_LABEL, LIMITS, isMatched, validatePost,
  type Audience, type Filters, type Photo as PhotoT, type Profile, discoverQueue,
} from '@lovoki/core';
import { store, useAppState } from '../store';
import { Avatar, ConfirmDialog, Counter, Dialog, FieldError, Notice, Photo, useToast } from '../ui';

/* ---------- block / report / unmatch, reused on every surface ---------- */
const REASONS = ['Fake profile or impersonation', 'Inappropriate photos or messages', 'Harassment or hate', 'Seems under 18', 'Scam or spam', 'Something else'];

export function useSafety(profile: Profile | undefined, opts: { afterBlock?: () => void; afterUnmatch?: () => void } = {}) {
  const s = useAppState();
  const toast = useToast();
  const [dlg, setDlg] = useState<null | 'block' | 'report' | 'unmatch'>(null);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!profile) return { items: [], dialogs: null as ReactNode };
  const matched = isMatched(s, profile.id);

  const submitReport = async () => {
    if (!reason) { setErr('Choose a reason so we know what happened.'); return; }
    setBusy(true); setErr(null);
    try {
      await store.report(profile.id, reason, details);
      setDlg(null); setReason(''); setDetails('');
      toast({ text: `Report saved on this device (demo). Nothing was sent.` });
    } catch { setErr('Report could not be saved. Check the demo network toggle and try again.'); }
    finally { setBusy(false); }
  };

  const items = [
    ...(matched ? [{ label: 'Unmatch', icon: <HeartOff size={18} />, onSelect: () => setDlg('unmatch') }] : []),
    { label: 'Report', icon: <Flag size={18} />, onSelect: () => setDlg('report') },
    { label: `Block ${profile.name.split(' ')[0]}`, icon: <Ban size={18} />, danger: true, onSelect: () => setDlg('block') },
  ];

  const first = profile.name.split(' ')[0];
  const dialogs = (
    <>
      <ConfirmDialog open={dlg === 'block'} onClose={() => setDlg(null)} title={`Block ${first}?`} confirmLabel="Block"
        body={<>They won’t appear in Discover, your feed, connections or messages, and any match ends. They aren’t notified. You can unblock from Settings.</>}
        onConfirm={() => { store.block(profile.id); toast({ text: `${first} is blocked.` }); opts.afterBlock?.(); }} />
      <ConfirmDialog open={dlg === 'unmatch'} onClose={() => setDlg(null)} title={`Unmatch with ${first}?`} confirmLabel="Unmatch"
        body="Your conversation will be removed and you won’t see each other in Discover again."
        onConfirm={() => { store.unmatch(profile.id); toast({ text: `You unmatched with ${first}.` }); opts.afterUnmatch?.(); }} />
      <Dialog open={dlg === 'report'} onClose={() => setDlg(null)} title={`Report ${first}`}
        footer={<><button className="btn btn-secondary" onClick={() => setDlg(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={submitReport} disabled={busy}>{busy ? 'Saving…' : 'Submit report'}</button></>}>
        <Notice>Demo: reports are kept on this device only. A real report would go to a moderation team.</Notice>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>What’s going on?</legend>
          <div className="stack" style={{ gap: 6 }}>
            {REASONS.map((r) => (
              <label key={r} className="radio-card"><input type="radio" name="reason" checked={reason === r} onChange={() => { setReason(r); setErr(null); }} />{r}</label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="report-details">Details (optional)</label>
          <textarea id="report-details" className="textarea" value={details} maxLength={500} onChange={(e) => setDetails(e.target.value)} />
        </div>
        {err && <Notice tone="error">{err}</Notice>}
        <p className="subtle">You can also block {first} so they can’t see you.</p>
      </Dialog>
    </>
  );
  return { items, dialogs };
}

/* ---------- mutual match moment ---------- */
export function MatchDialog({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const me = useAppState().me;
  const nav = useNavigate();
  return (
    <Dialog open={!!profile} onClose={onClose} title="It’s mutual"
      footer={profile && <><button className="btn btn-secondary" onClick={onClose}>Keep discovering</button>
        <button className="btn btn-primary" onClick={() => { onClose(); nav(`/messages/${profile.id}`); }}><MessageCircle size={18} />Send a message</button></>}>
      {profile && <>
        <div className="match-hero"><Avatar profile={me} size={96} /><Avatar profile={profile} size={96} /></div>
        <p style={{ textAlign: 'center', fontSize: 'var(--fs-body-lg)' }}>You and {profile.name.split(' ')[0]} liked each other. You can message now.</p>
        <Notice>Demo match: {profile.name.split(' ')[0]} is a synthetic profile scripted to like you back.</Notice>
      </>}
    </Dialog>
  );
}

/* ---------- discover filters ---------- */
export function FiltersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useAppState();
  const [f, setF] = useState<Filters>(s.filters);
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) { setF(s.filters); setLastOpen(true); }
  if (!open && lastOpen) setLastOpen(false);
  const preview = useMemo(() => discoverQueue({ ...s, filters: f }).length, [s, f]);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const ageErr = f.ageMin > f.ageMax ? 'Minimum age is above the maximum.' : undefined;

  return (
    <Dialog open={open} onClose={onClose} title="Filters"
      footer={<><button className="btn btn-ghost" onClick={() => setF({ ...DEFAULT_FILTERS })}>Reset filters</button>
        <button className="btn btn-primary" disabled={!!ageErr} onClick={() => { store.setFilters(f); onClose(); }}>Show {preview} {preview === 1 ? 'person' : 'people'}</button></>}>
      <div className="field">
        <span className="label">Age: {f.ageMin}–{f.ageMax}</span>
        <div className="range-row">
          <label><span className="sr-only">Minimum age</span><input type="range" min={18} max={60} value={f.ageMin} onChange={(e) => setF({ ...f, ageMin: +e.target.value })} /></label>
          <label><span className="sr-only">Maximum age</span><input type="range" min={18} max={60} value={f.ageMax} onChange={(e) => setF({ ...f, ageMax: +e.target.value })} /></label>
        </div>
        <FieldError id="age-err">{ageErr}</FieldError>
      </div>
      <div className="field">
        <label htmlFor="dist" className="label">Within {f.maxDistanceKm} km</label>
        <input id="dist" type="range" min={1} max={100} value={f.maxDistanceKm} onChange={(e) => setF({ ...f, maxDistanceKm: +e.target.value })} />
        <span className="hint">Distances are approximate. Nobody sees your exact location.</span>
      </div>
      <div className="field">
        <span className="label">Looking for</span>
        <div className="chips">{ALL_INTENTIONS.map((i) => (
          <button key={i} className="chip chip-toggle" aria-pressed={f.intentions.includes(i)} onClick={() => setF({ ...f, intentions: toggle(f.intentions, i) })}>{INTENTION_LABEL[i]}</button>
        ))}</div>
      </div>
      <div className="field">
        <span className="label">Shares any of these interests</span>
        <div className="chips">{ALL_INTERESTS.map((i) => (
          <button key={i} className="chip chip-toggle" aria-pressed={f.interests.includes(i)} onClick={() => setF({ ...f, interests: toggle(f.interests, i) })}>{i}</button>
        ))}</div>
      </div>
    </Dialog>
  );
}

/* ---------- post composer ---------- */
export function ComposerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useAppState();
  const toast = useToast();
  const [caption, setCaption] = useState('');
  const [photo, setPhoto] = useState<PhotoT | null>(null);
  const [audience, setAudience] = useState<Audience>(s.privacy.socialVisibility);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setCaption(''); setPhoto(null); setErr(null); setAudience(s.privacy.socialVisibility); };
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Choose an image file (JPG, PNG, WebP or GIF).'); return; }
    if (file.size > 8 * 1024 * 1024) { setErr('That image is over 8 MB. Choose a smaller one.'); return; }
    const reader = new FileReader();
    reader.onload = () => { setPhoto({ id: `local-${Date.now()}`, kind: 'uri', uri: String(reader.result), alt: 'Your photo' }); setErr(null); };
    reader.onerror = () => setErr('That image could not be read. Try another file.');
    reader.readAsDataURL(file);
  };
  const publish = async () => {
    const v = validatePost(caption, photo);
    if (v) { setErr(v); return; }
    setBusy(true); setErr(null);
    try { await store.publishPost(caption, photo, audience); reset(); onClose(); toast({ text: 'Published to your local demo feed.' }); }
    catch { setErr('Couldn’t publish. Your post is still here, so you can try again.'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} title="New post"
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={publish} disabled={busy}>{busy ? 'Publishing…' : err && !validatePost(caption, photo) ? 'Try again' : 'Publish'}</button></>}>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      {photo ? (
        <div className="composer-preview"><Photo photo={photo} />
          <button className="icon-btn" aria-label="Remove photo" onClick={() => setPhoto(null)}><X size={18} /></button></div>
      ) : (
        <button type="button" className="dropzone" onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
          <ImagePlus size={28} aria-hidden /><span><b>Choose a photo</b> or drop it here</span><span className="subtle">Stays on this device in the demo</span>
        </button>
      )}
      <div className="field">
        <label htmlFor="caption">Caption</label>
        <textarea id="caption" className="textarea" value={caption} onChange={(e) => { setCaption(e.target.value); setErr(null); }} placeholder="What’s the story behind it?" />
        <Counter value={caption.length} max={LIMITS.caption} />
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="field">
        <legend className="label" style={{ marginBottom: 8 }}>Who can see this</legend>
        <div className="radio-cards">
          <label className="radio-card"><input type="radio" name="aud" checked={audience === 'public'} onChange={() => setAudience('public')} />
            <span><Globe size={16} aria-hidden /> Public<small>Anyone on LOVOKI</small></span></label>
          <label className="radio-card"><input type="radio" name="aud" checked={audience === 'followers'} onChange={() => setAudience('followers')} />
            <span><Users size={16} aria-hidden /> Followers<small>Only people who follow you</small></span></label>
        </div>
        <span className="hint">Posts never show who you’ve liked or matched with.</span>
      </fieldset>
      {err && <Notice tone="error">{err}</Notice>}
    </Dialog>
  );
}
