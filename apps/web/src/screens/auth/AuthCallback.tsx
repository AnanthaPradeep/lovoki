import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { mapAuthError, safeCallbackNext, type AuthFailure } from '@lovoki/core';
import { useAuth } from '../../auth/AuthProvider';
import { Spinner } from '../../ui';
import { AuthLayout } from './AuthLayout';

// An email-link code is single use. React StrictMode runs effects twice in development, so share one in-flight attempt per URL.
const inflight = new Map<string, Promise<{ next: string | null }>>();

export function AuthCallback() {
  const { api, refresh } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState<AuthFailure | null>(null);

  useEffect(() => {
    let alive = true;
    const href = window.location.href;
    let p = inflight.get(href);
    if (!p) { p = api.completeCallback(href); inflight.set(href, p); }
    p.then(async ({ next }) => { await refresh(); if (alive) nav(safeCallbackNext(next), { replace: true }); })
      .catch((e) => { if (alive) setErr(mapAuthError(e)); });
    return () => { alive = false; };
  }, [api, refresh, nav]);

  if (!err) return <AuthLayout title="Confirming…"><div className="row" role="status"><Spinner label="Confirming your link" /><span className="muted">One moment.</span></div></AuthLayout>;
  return (
    <AuthLayout title="That link didn’t work">
      <div className="row" style={{ alignItems: 'flex-start' }}><AlertCircle size={22} aria-hidden style={{ flex: 'none', marginTop: 2 }} /><p>{err.message}</p></div>
      <p className="muted">If you just confirmed your email, try logging in. Otherwise request a new link.</p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Link to="/login" className="btn btn-primary">Log in</Link>
        <Link to="/forgot-password" className="btn btn-secondary">Reset password</Link>
        <Link to="/check-email" className="btn btn-ghost">Resend confirmation</Link>
      </div>
    </AuthLayout>
  );
}
