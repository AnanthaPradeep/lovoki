import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { mapAuthError, validateEmail } from '@lovoki/core';
import { useAuth } from '../../auth/AuthProvider';
import { Notice } from '../../ui';
import { TextField, focusFirstInvalid, useCooldown, useSubmit } from '../../ui/fields';
import { AuthLayout } from './AuthLayout';

export function ForgotPassword() {
  const { api } = useAuth();
  const [params] = useSearchParams();
  const { busy, run } = useSubmit();
  const { left, start } = useCooldown('lovoki.user.reset-until', 60);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const [fail, setFail] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const bad = validateEmail(email) ?? undefined;
    setErr(bad); setFail(null);
    if (bad) { focusFirstInvalid(); return; }
    if (left > 0) return;
    void run(async () => { try { await api.requestPasswordReset(email); setSent(true); start(); } catch (e2) { setFail(mapAuthError(e2).message); } });
  };

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we’ll send a link if there’s an account for it."
      footer={<p className="muted"><Link to="/login">Back to log in</Link></p>}>
      <form className="stack" onSubmit={submit} noValidate style={{ gap: 20 }}>
        {params.get('expired') === '1' && !sent && <Notice tone="warning">That reset link has expired or can’t be used. Request a new one.</Notice>}
        {sent && <Notice tone="success">If there’s an account for that email, a reset link is on its way. It works in this browser and expires after a short time.</Notice>}
        {fail && <Notice tone="error">{fail}</Notice>}
        <TextField id="email" name="email" label="Email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} error={err} />
        <button className="btn btn-primary btn-block" disabled={busy || left > 0}>{busy ? 'Sending…' : left > 0 ? `Send again in ${left}s` : sent ? 'Send another link' : 'Send reset link'}</button>
      </form>
    </AuthLayout>
  );
}
