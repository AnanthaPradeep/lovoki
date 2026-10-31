import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { mapAuthError, validateEmail, validatePassword, PASSWORD_RULES } from '@lovoki/core';
import { useAuth } from '../../auth/AuthProvider';
import { Notice } from '../../ui';
import { PasswordField, TextField, focusFirstInvalid, useSubmit } from '../../ui/fields';
import { AuthLayout, PENDING_EMAIL_KEY } from './AuthLayout';

export function SignUp() {
  const { api } = useAuth();
  const nav = useNavigate();
  const { busy, run } = useSubmit();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [errs, setErrs] = useState<{ email?: string; password?: string }>({});
  const [fail, setFail] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const er = { email: validateEmail(email) ?? undefined, password: validatePassword(pw, email) ?? undefined };
    setErrs(er); setFail(null);
    if (er.email || er.password) { focusFirstInvalid(); return; }
    void run(async () => {
      try {
        const r = await api.signUp(email, pw);
        try { sessionStorage.setItem(PENDING_EMAIL_KEY, email.trim()); } catch { /* ignore */ }
        nav(r.needsConfirmation ? '/check-email' : '/onboarding', { replace: true });
      } catch (err) { setFail(mapAuthError(err).message); }
    });
  };

  return (
    <AuthLayout title="Create your account" subtitle="Use an email you can open now. We’ll send a link to confirm it."
      footer={<p className="muted">Already have an account? <Link to="/login">Log in</Link></p>}>
      <form className="stack" onSubmit={submit} noValidate method="post" style={{ gap: 20 }}>
        {fail && <Notice tone="error">{fail}</Notice>}
        <TextField id="email" name="email" label="Email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
          value={email} onChange={(e) => setEmail(e.target.value)} error={errs.email} />
        <PasswordField id="password" name="password" label="Password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)}
          error={errs.password} hint={`At least ${PASSWORD_RULES.min} characters. A password manager works well here.`} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        <p className="subtle">You must be 18 or over. We’ll ask for your date of birth next. Terms and a privacy policy aren’t published for this development build.</p>
      </form>
    </AuthLayout>
  );
}
