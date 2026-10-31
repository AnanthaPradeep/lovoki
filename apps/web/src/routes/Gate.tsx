import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { decideRoute } from '@lovoki/core';
import { useAuth } from '../auth/AuthProvider';
import { useAccount } from '../account/AccountProvider';
import { EmptyState } from '../ui';
import { AlertCircle } from 'lucide-react';

export function PageSkeleton() {
  return (
    <div className="page stack" aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 32, width: 180 }} />
      <div className="skeleton" style={{ aspectRatio: '4 / 5', borderRadius: 22, maxHeight: 420 }} />
    </div>
  );
}

/** The one place that decides who may see which route. The decision itself is pure and unit-tested in @lovoki/core. */
export function Gate({ children }: { children: ReactNode }) {
  const { state, signOut } = useAuth();
  const acct = useAccount();
  const loc = useLocation();
  const d = decideRoute({
    mode: 'supabase', path: loc.pathname, search: loc.search, auth: state.status, emailConfirmed: state.user?.emailConfirmed,
    account: acct.status, onboardingComplete: acct.account ? !!acct.account.onboarding.completedAt : null,
  });
  if (d.kind === 'wait') return <PageSkeleton />;
  if (d.kind === 'redirect') return <Navigate to={d.to} replace />;
  if (d.kind === 'account-error') {
    return (
      <div className="page">
        <EmptyState icon={<AlertCircle size={28} />} title="We couldn’t load your profile"
          body={acct.error?.code === 'unauthorized' ? 'Your session ended. Log in again to continue.' : (acct.error?.message ?? 'Something went wrong.')}
          action={<div className="row">
            {acct.error?.code !== 'unauthorized' && <button className="btn btn-primary" onClick={acct.retry}>Try again</button>}
            <button className="btn btn-secondary" onClick={() => void signOut()}>Log out</button></div>} />
      </div>
    );
  }
  return <>{children}</>;
}
