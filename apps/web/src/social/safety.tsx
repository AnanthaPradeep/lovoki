import { useState } from 'react';
import { REPORT_REASONS, SOCIAL_RULES, SocialFailure, charCount, validateReport, type ReportReason, type ReportTarget } from '@lovoki/core';
import { Counter, Dialog, Notice, useToast } from '../ui';
import { useSocial } from './SocialProvider';

/**
 * Report flow shared by posts, comments and profiles.
 * Copy is deliberately modest: the report is SAVED FOR REVIEW. Nothing is removed or decided automatically,
 * and there is no promise of an outcome or a reply.
 */
export function ReportDialog({ open, onClose, target, targetId, subject }: { open: boolean; onClose: () => void; target: ReportTarget; targetId: string; subject: string }) {
  const { api } = useSocial();
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const close = () => { setReason(''); setDetails(''); setErr(null); onClose(); };

  const submit = async () => {
    if (busy) return;
    const bad = validateReport(reason, details);
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr(null);
    try {
      await api.report(target, targetId, reason as ReportReason, details);
      toast({ text: 'Report saved for review.' });
      close();
    } catch (e) { setErr(e instanceof SocialFailure ? e.message : 'The report couldn’t be saved. Try again.'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={close} title={`Report ${subject}`}
      footer={<><button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : err ? 'Try again' : 'Save report'}</button></>}>
      <Notice>Your report is saved for review. LOVOKI doesn’t remove anything automatically, and you won’t get an update on individual reports. Blocking is immediate if you want distance now.</Notice>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>What’s going on?</legend>
        <div className="stack" style={{ gap: 6 }}>
          {REPORT_REASONS.map((r) => (
            <label key={r.value} className="radio-card" style={{ minHeight: 44, alignItems: 'center' }}>
              <input type="radio" name={`reason-${targetId}`} checked={reason === r.value} onChange={() => { setReason(r.value); setErr(null); }} />{r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor={`rd-${targetId}`}>Details (optional)</label>
        <textarea id={`rd-${targetId}`} className="textarea" value={details} onChange={(e) => setDetails(e.target.value)} />
        <Counter value={charCount(details)} max={SOCIAL_RULES.reportDetailsMax} />
      </div>
      {err && <Notice tone="error">{err}</Notice>}
    </Dialog>
  );
}

export function BlockDialog({ open, onClose, name, onBlocked }: { open: boolean; onClose: () => void; name: string; onBlocked: () => Promise<void> }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await onBlocked(); onClose(); }
    catch (e) { setErr(e instanceof SocialFailure ? e.message : 'Couldn’t block them. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={`Block ${name}?`}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-danger" onClick={() => void run()} disabled={busy} aria-busy={busy}>{busy ? 'Blocking…' : 'Block'}</button></>}>
      <p className="muted">You won’t see each other’s profile, posts, comments or notifications, and any follow between you ends. They aren’t told. You can unblock from Settings, but follows don’t come back.</p>
      {err && <Notice tone="error">{err}</Notice>}
    </Dialog>
  );
}
