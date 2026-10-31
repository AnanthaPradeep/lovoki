import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ModeBadge } from '../../components/ModeBadge';
import { useTitle } from '../../ui/useTitle';

export const PENDING_EMAIL_KEY = 'lovoki.user.pending-email';
export const RESEND_KEY = 'lovoki.user.resend-until';
export const readPendingEmail = () => { try { return sessionStorage.getItem(PENDING_EMAIL_KEY) ?? ''; } catch { return ''; } };

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useTitle(title);
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => { h1.current?.focus({ preventScroll: true }); }, []);
  return (
    <div className="auth-shell">
      <header className="auth-top"><Link to="/welcome" className="wordmark" aria-label="LOVOKI home" style={{ padding: 0 }}>LOVOKI</Link><ModeBadge mode="supabase" /></header>
      <main id="main" className="auth-main">
        <div className="auth-card card">
          <h1 ref={h1} tabIndex={-1} style={{ outline: 'none' }}>{title}</h1>
          {subtitle && <p className="muted" style={{ marginTop: 8 }}>{subtitle}</p>}
          <div className="stack" style={{ marginTop: 24, gap: 20 }}>{children}</div>
        </div>
        {footer && <div className="auth-foot">{footer}</div>}
      </main>
    </div>
  );
}
