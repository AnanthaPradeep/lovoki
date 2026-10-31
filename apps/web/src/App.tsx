import { useMemo } from 'react';
import { Route, Routes } from 'react-router-dom';
import { unreadTotal } from '@lovoki/core';
import { useAppState, useStatus } from './store';
import { useApplyTheme } from './ui-prefs';
import { Shell } from './components/Shell';
import { ModeBadge } from './components/ModeBadge';
import { Discover } from './screens/Discover';
import { ProfileDetail } from './screens/ProfileDetail';
import { Feed } from './screens/Feed';
import { Connections } from './screens/Connections';
import { Messages, Chat } from './screens/Messages';
import { Me, EditProfile } from './screens/Me';
import { Settings } from './screens/Settings';
import { NotFound } from './screens/NotFound';
import { Navigate } from 'react-router-dom';

/** Demo mode: the Phase 1 experience on local synthetic data. Never touches Supabase or real accounts. */
export function DemoApp() {
  const s = useAppState();
  useApplyTheme(s.theme);
  const { hydrated } = useStatus();
  const unread = useMemo(() => unreadTotal(s), [s]);
  return (
    <Shell unread={unread} footer={<div style={{ padding: '0 12px 8px' }}><ModeBadge mode="demo" /></div>}>
      {!hydrated ? <div className="page stack" aria-busy="true"><div className="skeleton" style={{ height: 32, width: 180 }} /><div className="skeleton" style={{ aspectRatio: '4/5', borderRadius: 22 }} /></div> : (
        <Routes>
          <Route path="/" element={<Navigate to="/discover" replace />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/u/:id" element={<ProfileDetail />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/messages/:id" element={<Chat />} />
          <Route path="/me" element={<Me />} />
          <Route path="/me/edit" element={<EditProfile />} />
          <Route path="/settings" element={<Settings />} />
          {/* Real-mode URLs bookmarked by a developer land on Discover rather than a dead end. */}
          {['/welcome', '/signup', '/login', '/forgot-password', '/check-email', '/auth/callback', '/reset-password', '/onboarding/*'].map((p) => <Route key={p} path={p} element={<Navigate to="/discover" replace />} />)}
          <Route path="*" element={<NotFound />} />
        </Routes>
      )}
    </Shell>
  );
}
