import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { mapAuthError, validateEmail, validatePassword, PASSWORD_RULES, TERMS_VERSION } from '@lovoki/core';
import { useAuth } from '../../auth/AuthProvider';
import { useCaptcha } from '../../auth/Captcha';
import { FieldError, Notice } from '../../ui';
import { PasswordField, TextField, focusFirstInvalid, useSubmit } from '../../ui/fields';
import { AuthLayout, PENDING_EMAIL_KEY } from './AuthLayout';

export function SignUp() {
  const { api } = useAuth();
  const nav = useNavigate();
  const { busy, run } = useSubmit();
  const captcha = useCaptcha();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [agree, setAgree] = useState(false);
  const [marketing, setMarketing] = useState(false); // separate from the terms, and off unless you turn it on
  const [errs, setErrs] = useState<{ email?: string; password?: string; agree?: string; captcha?: string }>({});
  const [fail, setFail] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const er = {
      email: validateEmail(email) ?? undefined, password: validatePassword(pw, email) ?? undefined,
      agree: agree ? undefined : 'Confirm you’re 18 or over and accept the terms to continue.',
      captcha: captcha.enabled && !captcha.token ? 'Complete the security check.' : undefined,
    };
    setErrs(er); setFail(null);
    if (er.email || er.password || er.agree || er.captcha) { focusFirstInvalid(); return; }
    void run(async () => {
      try {
        const r = await api.signUp(email, pw, { captchaToken: captcha.token ?? undefined, consent: { termsVersion: TERMS_VERSION, confirm18: true, marketing } });
        try { sessionStorage.setItem(PENDING_EMAIL_KEY, email.trim()); } catch { /* ignore */ }
        nav(r.needsConfirmation ? '/check-email' : '/onboarding', { replace: true });
      } catch (err) { setFail(mapAuthError(err).message); captcha.reset(); }
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
        <div className="field" data-invalid={!!errs.agree}>
          <label className="row" style={{ gap: 12, alignItems: 'flex-start', minHeight: 44 }}>
            <input type="checkbox" name="agree" checked={agree} onChange={(e) => setAgree(e.target.checked)} aria-invalid={!!errs.agree} aria-describedby="agree-err" style={{ marginTop: 4, width: 20, height: 20, flex: 'none' }} />
            <span>I’m 18 or over, and I accept the <Link to="/terms" target="_blank" rel="noopener">Terms</Link> and <Link to="/privacy" target="_blank" rel="noopener">Privacy Policy</Link> <span className="subtle">(drafts, not yet reviewed by a lawyer)</span>.</span>
          </label>
          <FieldError id="agree-err">{errs.agree}</FieldError>
        </div>
        <label className="row" style={{ gap: 12, alignItems: 'flex-start', minHeight: 44 }}>
          <input type="checkbox" name="marketing" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} style={{ marginTop: 4, width: 20, height: 20, flex: 'none' }} />
          <span>Send me product news by email <span className="subtle">(optional, off by default, and you can change it in Settings)</span>.</span>
        </label>
        {captcha.element}
        <FieldError id="captcha-err">{errs.captcha}</FieldError>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        <p className="subtle">We’ll ask for your date of birth next. Your age is shown to others; your date of birth never is.</p>
      </form>
    </AuthLayout>
  );
}
