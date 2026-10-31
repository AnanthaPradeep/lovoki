import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { mapAuthError, validateEmail, type AuthErrorCode } from '@lovoki/core';
import { useAuth } from '../../auth/AuthProvider';
import { Notice } from '../../ui';
import { PasswordField, TextField, focusFirstInvalid, useSubmit } from '../../ui/fields';
import { AuthLayout, PENDING_EMAIL_KEY } from './AuthLayout';

export function Login() {
  const { api, state, dismissNotice } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { busy, run } = useSubmit();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [errs, setErrs] = useState<{ email?: string; password?: string }>({});
  const [fail, setFail] = useState<{ code: AuthErrorCode; message: string } | null>(null);
  const next = params.get('next');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const er = { email: validateEmail(email) ?? undefined, password: pw ? undefined : 'Enter your password.' };
    setErrs(er); setFail(null); dismissNotice();
    if (er.email || er.password) { focusFirstInvalid(); return; }
    // On success the route gate sends the person to onboarding or to a validated ?next= destination.
    void run(async () => { try { await api.signIn(email, pw); } catch (err) { const f = mapAuthError(err); setFail({ code: f.code, message: f.message }); } });
  };
  const confirmFirst = () => { try { sessionStorage.setItem(PENDING_EMAIL_KEY, email.trim()); } catch { /* ignore */ } nav('/check-email'); };

  return (
    <AuthLayout title="Log in" footer={<p className="muted">New here? <Link to="/signup">Create an account</Link></p>}>
      <form className="stack" onSubmit={submit} noValidate method="post" style={{ gap: 20 }}>
        {state.notice === 'expired' && <Notice tone="warning">Your session expired. Log in again to continue.</Notice>}
        {params.get('reset') === '1' && <Notice tone="success">Password updated. Log in with your new password.</Notice>}
        {next && !fail && <Notice>Log in to continue.</Notice>}
        {fail && <Notice tone="error" action={fail.code === 'email_not_confirmed' ? <button type="button" className="btn btn-secondary btn-sm" onClick={confirmFirst}>Resend link</button> : undefined}>{fail.message}</Notice>}
        <TextField id="email" name="email" label="Email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
          value={email} onChange={(e) => setEmail(e.target.value)} error={errs.email} />
        <PasswordField id="password" name="password" label="Password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} error={errs.password} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        <Link to="/forgot-password" style={{ justifySelf: 'center' }}>Forgot your password?</Link>
      </form>
    </AuthLayout>
  );
}
