import { useEffect, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Compass, LayoutGrid, Users, MessageCircle, UserRound, Settings as SettingsIcon } from 'lucide-react';

export const NAV = [
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/feed', label: 'Feed', icon: LayoutGrid },
  { to: '/connections', label: 'Connections', icon: Users },
  { to: '/messages', label: 'Messages', icon: MessageCircle },
  { to: '/me', label: 'Profile', icon: UserRound },
];

/** Navigation frame shared by demo and real mode. Knows nothing about where data comes from. */
export function Shell({ children, unread = 0, footer }: { children: ReactNode; unread?: number; footer?: ReactNode }) {
  const loc = useLocation();
  useEffect(() => { document.getElementById('main')?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [loc.pathname]);
  const link = (n: (typeof NAV)[number], compact = false) => (
    <NavLink key={n.to} to={n.to} className={compact ? '' : 'nav-link'} aria-label={compact ? undefined : n.label}>
      <n.icon size={compact ? 24 : 22} aria-hidden />
      <span className="label">{n.label}</span>
      {n.to === '/messages' && unread > 0 && <span className="badge" aria-label={`${unread} unread`}>{unread}</span>}
    </NavLink>
  );
  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
      <div className="shell">
        <nav className="sidebar" aria-label="Primary">
          <NavLink to="/discover" className="wordmark" aria-label="LOVOKI home">LOVOKI<span>Meet the person behind the profile</span></NavLink>
          {NAV.map((n) => link(n))}
          <div className="sidebar-foot">
            {footer}
            <NavLink to="/settings" className="nav-link" aria-label="Settings"><SettingsIcon size={22} aria-hidden /><span className="label">Settings</span></NavLink>
          </div>
        </nav>
        <main id="main" className="main" tabIndex={-1} style={{ outline: 'none' }}>{children}</main>
        <nav className="bottom-nav" aria-label="Primary">{NAV.map((n) => link(n, true))}</nav>
      </div>
    </>
  );
}
