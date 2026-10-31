import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { mapAuthError, validatePassword, PASSWORD_RULES } from '@lovoki/core';
import { useAuth } from '../../auth/AuthProvider';
import { Notice, useToast } from '../../ui';
import { PasswordField, focusFirstInvalid, useSubmit } from '../../ui/fields';
import { AuthLayout } from './AuthLayout';

export function ResetPassword() {
  const { api, state } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { busy, run } = useSubmit();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const [fail, setFail] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const bad = validatePassword(pw, state.user?.email ?? '') ?? undefined;
    setErr(bad); setFail(null);
    if (bad) { focusFirstInvalid(); return; }
    void run(async () => {
      try { await api.updatePassword(pw); toast({ text: 'Password updated.' }); nav('/discover', { replace: true }); }
      catch (e2) { setFail(mapAuthError(e2).message); }
    });
  };

  return (
    <AuthLayout title="Choose a new password" subtitle={state.user?.email ? <>For <span className="break">{state.user.email}</span></> : undefined}>
      <form className="stack" onSubmit={submit} noValidate method="post" style={{ gap: 20 }}>
        {fail && <Notice tone="error">{fail}</Notice>}
        <input className="sr-only" tabIndex={-1} aria-hidden="true" autoComplete="username" readOnly value={state.user?.email ?? ''} name="username" />
        <PasswordField id="new-password" name="new-password" label="New password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)}
          error={err} hint={`At least ${PASSWORD_RULES.min} characters.`} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
      </form>
    </AuthLayout>
  );
}
