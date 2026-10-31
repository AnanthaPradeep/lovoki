import { useCallback, useMemo } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import type { AccountApi, AuthApi, AuthUser, DatingApi, SocialApi } from '@lovoki/core';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AccountProvider } from './account/AccountProvider';
import { Gate } from './routes/Gate';
import { Shell } from './components/Shell';
import { ModeBadge } from './components/ModeBadge';
import { getSupabase } from './data/supabaseClient';
import { SupabaseAuthApi } from './data/SupabaseAuthApi';
import { SupabaseAccountApi } from './data/SupabaseAccountApi';
import { SupabaseSocialApi } from './data/SupabaseSocialApi';
import { SupabaseDatingApi } from './data/SupabaseDatingApi';
import { SocialProvider, useSocialOptional } from './social/SocialProvider';
import { userScope } from './data/userScope';
import { useApplyTheme, useThemePref } from './ui-prefs';
import { Welcome } from './screens/auth/Welcome';
import { SignUp } from './screens/auth/SignUp';
import { Login } from './screens/auth/Login';
import { CheckEmail } from './screens/auth/CheckEmail';
import { ForgotPassword } from './screens/auth/ForgotPassword';
import { AuthCallback } from './screens/auth/AuthCallback';
import { ResetPassword } from './screens/auth/ResetPassword';
import { Onboarding, OnboardingRedirect } from './screens/onboarding/Onboarding';
import { RealMe } from './screens/real/RealMe';
import { RealEditProfile } from './screens/real/RealEditProfile';
import { RealSettings } from './screens/real/RealSettings';
import { Unavailable } from './screens/real/Unavailable';
import { RealFeed } from './screens/real/RealFeed';
import { RealConnections } from './screens/real/RealConnections';
import { RealNotifications } from './screens/real/RealNotifications';
import { RealProfile } from './screens/real/RealProfile';
import { RealDiscover } from './screens/real/RealDiscover';
import { RealDatingProfile } from './screens/real/RealDatingProfile';
import { NotFound } from './screens/NotFound';

function AppShell() {
  const { signOut } = useAuth();
  const social = useSocialOptional(); // null for signed-out visitors who land on the not-found page
  return (
    <Shell notifications={social?.unread} footer={<div style={{ padding: '0 12px 8px', display: 'grid', gap: 8 }}><ModeBadge mode="supabase" />
      <button className="nav-link" style={{ border: 0, background: 'none', width: '100%' }} onClick={() => void signOut()} aria-label="Log out"><LogOut size={22} aria-hidden /><span className="label">Log out</span></button></div>}>
      <Outlet />
    </Shell>
  );
}

/** The real-mode UI, independent of where its data comes from (Supabase in production, in-memory fakes in UI tests). */
export function RealAppView({ authApi, make, makeSocial, makeDating }: { authApi: AuthApi; make: (u: AuthUser) => AccountApi; makeSocial: (u: AuthUser) => SocialApi; makeDating: (u: AuthUser) => DatingApi }) {
  useApplyTheme(useThemePref());
  return (
    <AuthProvider api={authApi}>
      <AccountProvider make={make}>
        <SocialProvider make={makeSocial} makeDating={makeDating}>
        <Gate>
          <Routes>
            <Route path="/" element={<Navigate to="/discover" replace />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/login" element={<Login />} />
            <Route path="/check-email" element={<CheckEmail />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/onboarding" element={<OnboardingRedirect />} />
            <Route path="/onboarding/:step" element={<Onboarding />} />
            <Route element={<AppShell />}>
              <Route path="/discover" element={<RealDiscover />} />
              <Route path="/discover/:id" element={<RealDatingProfile />} />
              <Route path="/u/:id" element={<RealProfile />} />
              <Route path="/feed" element={<RealFeed />} />
              <Route path="/connections" element={<RealConnections />} />
              <Route path="/notifications" element={<RealNotifications />} />
              <Route path="/messages" element={<Unavailable title="Messaging isn’t live yet" body="Conversations open after a mutual match, with realtime delivery." phase="Phase 5" />} />
              <Route path="/messages/:id" element={<Unavailable title="Messaging isn’t live yet" body="Conversations open after a mutual match, with realtime delivery." phase="Phase 5" />} />
              <Route path="/me" element={<RealMe />} />
              <Route path="/me/edit" element={<RealEditProfile />} />
              <Route path="/settings" element={<RealSettings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Gate>
        </SocialProvider>
      </AccountProvider>
    </AuthProvider>
  );
}

/** Real mode: Supabase auth + persisted profile. Social, dating and chat are honest "not yet" screens. */
export function RealApp({ cfg }: { cfg: { url: string; anonKey: string } }) {
  const sb = useMemo(() => getSupabase(cfg), [cfg]);
  const authApi = useMemo(() => new SupabaseAuthApi(sb), [sb]);
  const make = useCallback((u: AuthUser) => new SupabaseAccountApi(sb, u.id, u.email, userScope), [sb]);
  const makeSocial = useCallback((u: AuthUser) => new SupabaseSocialApi(sb, u.id, userScope), [sb]);
  const makeDating = useCallback(() => new SupabaseDatingApi(sb), [sb]);
  return <RealAppView authApi={authApi} make={make} makeSocial={makeSocial} makeDating={makeDating} />;
}
