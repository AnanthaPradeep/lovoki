import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, LogOut, Mail, ShieldCheck } from 'lucide-react';
import { PASSWORD_RULES, mapAuthError, validateEmail, validatePassword, type SessionInfo } from '@lovoki/core';
import { useAuth } from '../auth/AuthProvider';
import { useReadyAccount } from '../account/AccountProvider';
import { ConfirmDialog, Notice, useToast } from '../ui';
import { PasswordField, TextField, focusFirstInvalid, useSubmit } from '../ui/fields';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown');

/** Real controls only: every button here calls the server. There is no device list because the platform has none to show. */
export function AccountSecurity() {
  const { api, signOut } = useAuth();
  const { account } = useReadyAccount();
  const toast = useToast();
  const [info, setInfo] = useState<SessionInfo | null | 'error'>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const load = () => { api.sessionInfo().then(setInfo).catch(() => setInfo('error')); };
  useEffect(load, [api]);

  return (
    <section className="card card-pad stack" aria-labelledby="security" style={{ gap: 20 }}><h2 id="security">Account security</h2>
      <div className="stack" style={{ gap: 6 }} data-testid="session-info">
        <b><ShieldCheck size={16} aria-hidden style={{ verticalAlign: -3, marginRight: 6 }} />This session</b>
        {info === null ? <div className="skeleton" style={{ height: 40 }} aria-busy="true" aria-label="Loading session" />
          : info === 'error' ? <Notice tone="error" action={<button type="button" className="btn btn-secondary btn-sm" onClick={load}>Try again</button>}>Couldn’t load your session details.</Notice>
          : <ul className="muted stack" style={{ gap: 2, margin: 0, paddingLeft: 20 }}>
              <li>Signed in as <b className="break">{info.email}</b> (via {info.provider})</li><li>Last sign-in: {when(info.lastSignInAt)}</li><li>This session renews until: {when(info.expiresAt)}</li></ul>}
        {info && info !== 'error' && info.pendingEmail && <Notice>A change to <b className="break">{info.pendingEmail}</b> is waiting. Open the link we sent to that address to finish it. Until then your email stays <b className="break">{info.email}</b>.</Notice>}
      </div>
      <ChangePassword />
      <ChangeEmail current={info && info !== 'error' ? info.email : account.email} onSent={load} />
      <div className="stack" style={{ gap: 8 }}>
        <b><LogOut size={16} aria-hidden style={{ verticalAlign: -3, marginRight: 6 }} />Log out of all devices</b>
        <p className="muted">Ends this session and every other session of your account, wherever you’re signed in. Use it if you lost a device or shared your login.</p>
        <button type="button" className="btn btn-secondary" style={{ justifySelf: 'start' }} onClick={() => setConfirmAll(true)}>Log out everywhere</button>
      </div>
      <ConfirmDialog open={confirmAll} onClose={() => setConfirmAll(false)} title="Log out of all devices?" confirmLabel="Log out everywhere" danger={false}
        body="You’ll be logged out here and on every other device. Log in again with your password."
        onConfirm={() => { void api.signOutEverywhere().then(() => signOut()).catch((e) => toast({ text: mapAuthError(e).message, tone: 'error' })); }} />
    </section>
  );
}

function ChangePassword() {
  const { api } = useAuth();
  const toast = useToast();
  const { busy, run } = useSubmit();
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [again, setAgain] = useState('');
  const [errs, setErrs] = useState<{ cur?: string; next?: string; again?: string }>({}); const [fail, setFail] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const er = { cur: cur ? undefined : 'Enter your current password.', next: validatePassword(next) ?? (next === cur ? 'Choose a password you haven’t used for this account.' : undefined), again: again === next ? undefined : 'The two passwords don’t match.' };
    setErrs(er); setFail(null);
    if (er.cur || er.next || er.again) { focusFirstInvalid(); return; }
    void run(async () => {
      try { await api.changePassword(cur, next); setCur(''); setNext(''); setAgain(''); toast({ text: 'Password changed. Other devices stay signed in until you log them out.' }); }
      catch (err) { const f = mapAuthError(err); if (f.code === 'invalid_credentials') setErrs({ cur: 'Your current password is incorrect.' }); else setFail(f.message); }
    });
  };
  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={submit} noValidate aria-labelledby="pw-h">
      <b id="pw-h"><KeyRound size={16} aria-hidden style={{ verticalAlign: -3, marginRight: 6 }} />Change password</b>
      {fail && <Notice tone="error">{fail}</Notice>}
      <PasswordField id="pw-cur" name="current-password" label="Current password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} error={errs.cur} hint="We ask again so a stranger on an unlocked device can’t change it." />
      <PasswordField id="pw-new" name="new-password" label="New password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={errs.next} hint={`At least ${PASSWORD_RULES.min} characters.`} />
      <PasswordField id="pw-again" name="new-password-2" label="New password again" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} error={errs.again} />
      <button type="submit" className="btn btn-primary" style={{ justifySelf: 'start' }} disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
    </form>
  );
}

function ChangeEmail({ current, onSent }: { current: string | null; onSent: () => void }) {
  const { api } = useAuth();
  const toast = useToast();
  const { busy, run } = useSubmit();
  const [email, setEmail] = useState(''); const [err, setErr] = useState<string | undefined>(); const [fail, setFail] = useState<string | null>(null); const [sentTo, setSentTo] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const bad = validateEmail(email) ?? (email.trim().toLowerCase() === (current ?? '').toLowerCase() ? 'That’s already your email.' : undefined);
    setErr(bad ?? undefined); setFail(null);
    if (bad) { focusFirstInvalid(); return; }
    void run(async () => { try { await api.changeEmail(email); setSentTo(email.trim()); setEmail(''); onSent(); toast({ text: 'Confirmation sent to the new address.' }); } catch (e2) { setFail(mapAuthError(e2).message); } });
  };
  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={submit} noValidate aria-labelledby="em-h">
      <b id="em-h"><Mail size={16} aria-hidden style={{ verticalAlign: -3, marginRight: 6 }} />Change email</b>
      <p className="muted">Your email stays <b className="break">{current ?? 'unknown'}</b> until you open the confirmation link we send to the new address.</p>
      {fail && <Notice tone="error">{fail}</Notice>}
      {sentTo && <Notice tone="success">We sent a link to <b className="break">{sentTo}</b>. Open it in this browser to finish. Your login email hasn’t changed yet.</Notice>}
      <TextField id="em-new" name="email" label="New email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} error={err} />
      <button type="submit" className="btn btn-primary" style={{ justifySelf: 'start' }} disabled={busy}>{busy ? 'Sending…' : 'Send confirmation'}</button>
    </form>
  );
}
