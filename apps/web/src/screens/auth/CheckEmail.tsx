import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { mapAuthError, validateEmail } from '@lovoki/core';
import { useAuth } from '../../auth/AuthProvider';
import { Notice } from '../../ui';
import { TextField, useCooldown, useSubmit } from '../../ui/fields';
import { AuthLayout, PENDING_EMAIL_KEY, RESEND_KEY, readPendingEmail } from './AuthLayout';

export function CheckEmail() {
  const { api } = useAuth();
  const { busy, run } = useSubmit();
  const { left, start } = useCooldown(RESEND_KEY, 60);
  const [email, setEmail] = useState(readPendingEmail);
  const [sent, setSent] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [err, setErr] = useState<string | undefined>();
  const known = !!readPendingEmail();

  const resend = () => {
    const bad = validateEmail(email) ?? undefined;
    setErr(bad); setFail(null);
    if (bad || left > 0) return;
    void run(async () => {
      try { await api.resendConfirmation(email); try { sessionStorage.setItem(PENDING_EMAIL_KEY, email.trim()); } catch { /* ignore */ } setSent(true); start(); }
      catch (e) { setFail(mapAuthError(e).message); }
    });
  };

  return (
    <AuthLayout title="Check your email" footer={<p className="muted"><Link to="/login">Back to log in</Link></p>}>
      <div className="row" style={{ alignItems: 'flex-start' }}><Mail size={22} aria-hidden style={{ flex: 'none', marginTop: 2 }} />
        <p>{known ? <>If <b className="break">{email}</b> can receive mail, a confirmation link is on its way.</> : 'If your address can receive mail, a confirmation link is on its way.'} Open it in this browser to continue.</p></div>
      {sent && <Notice tone="success">If that address needs confirming, we’ve sent a new link.</Notice>}
      {fail && <Notice tone="error">{fail}</Notice>}
      {!known && <TextField id="email" name="email" label="Your email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} error={err} />}
      <button className="btn btn-secondary btn-block" onClick={resend} disabled={busy || left > 0}>
        {busy ? 'Sending…' : left > 0 ? `Resend available in ${left}s` : 'Resend confirmation link'}
      </button>
      <p className="subtle" aria-live="polite">Nothing yet? Check spam. Links work only in the browser where you signed up, and expire after a while.{known && <> Wrong address? <Link to="/signup">Start again</Link>.</>}</p>
    </AuthLayout>
  );
}
