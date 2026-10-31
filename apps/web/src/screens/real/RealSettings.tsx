import { useNavigate } from 'react-router-dom';
import { Monitor, Moon, Sun, LogOut } from 'lucide-react';
import { AccountFailure, type ThemePreference } from '@lovoki/core';
import { useAuth } from '../../auth/AuthProvider';
import { useReadyAccount } from '../../account/AccountProvider';
import { themeStore, useThemePref } from '../../ui-prefs';
import { Notice, useToast } from '../../ui';
import { useSubmit } from '../../ui/fields';
import { useTitle } from '../../ui/useTitle';
import { ModeBadge } from '../../components/ModeBadge';

const THEMES: { v: ThemePreference; label: string; icon: typeof Sun }[] = [{ v: 'system', label: 'System', icon: Monitor }, { v: 'light', label: 'Light', icon: Sun }, { v: 'dark', label: 'Dark', icon: Moon }];

export function RealSettings() {
  useTitle('Settings');
  const { account, api, reload } = useReadyAccount();
  const { signOut } = useAuth();
  const theme = useThemePref();
  const toast = useToast();
  const nav = useNavigate();
  const { busy, run } = useSubmit();

  const savePrivacy = (patch: Partial<{ socialVisibility: 'public' | 'followers'; datingDiscoverable: boolean }>) => run(async () => {
    try {
      await api.savePrivacy({ areaLabel: account.areaLabel, socialVisibility: account.socialVisibility, datingDiscoverable: account.datingDiscoverable, ...patch });
      await reload();
      toast({ text: 'Privacy settings saved.' });
    } catch (e) { toast({ text: e instanceof AccountFailure ? e.message : 'Couldn’t save that setting.', tone: 'error' }); }
  });
  const logout = async () => { await signOut(); nav('/welcome', { replace: true }); };

  return (
    <div className="page stack" style={{ gap: 24 }}>
      <div className="page-head" style={{ marginBottom: 0 }}><h1>Settings</h1></div>
      <section className="card card-pad stack" aria-labelledby="appearance"><h2 id="appearance">Appearance</h2>
        <div className="segmented" role="group" aria-label="Theme">
          {THEMES.map((t) => <button key={t.v} aria-pressed={theme === t.v} onClick={() => themeStore.set(t.v)}><t.icon size={16} aria-hidden style={{ verticalAlign: -3, marginRight: 6 }} />{t.label}</button>)}
        </div>
      </section>
      <section className="card card-pad" aria-labelledby="privacy"><h2 id="privacy" style={{ marginBottom: 8 }}>Privacy</h2>
        <div className="settings-group">
          <label className="switch-row"><span className="grow"><b>Show me in Discover</b><br /><span className="subtle">Dating discoverability. Separate from who can see your profile.</span></span>
            <input type="checkbox" className="switch" checked={account.datingDiscoverable} disabled={busy} onChange={(e) => void savePrivacy({ datingDiscoverable: e.target.checked })} /></label>
          <div className="switch-row"><span className="grow"><b>Who can see your profile and posts</b><br /><span className="subtle">Social visibility.</span></span>
            <div className="segmented" role="group" aria-label="Social visibility">
              <button aria-pressed={account.socialVisibility === 'public'} disabled={busy} onClick={() => void savePrivacy({ socialVisibility: 'public' })}>Public</button>
              <button aria-pressed={account.socialVisibility === 'followers'} disabled={busy} onClick={() => void savePrivacy({ socialVisibility: 'followers' })}>Followers</button>
            </div></div>
        </div>
      </section>
      <section className="card card-pad stack" aria-labelledby="account"><h2 id="account">Account</h2>
        <p className="muted">Signed in as <b className="break">{account.email}</b></p>
        <button className="btn btn-secondary" style={{ justifySelf: 'start' }} onClick={() => void logout()}><LogOut size={18} aria-hidden />Log out</button>
      </section>
      <section className="card card-pad stack" aria-labelledby="soon"><h2 id="soon">Not available yet</h2>
        <ul className="muted stack" style={{ gap: 6, margin: 0, paddingLeft: 20 }}>
          <li>Blocked accounts: with the social and dating features</li>
          <li>Notification preferences: with messaging</li>
          <li>Identity or photo verification: not built, so no profile is shown as verified</li>
          <li>Account deletion and data export: before public release</li>
        </ul>
        <Notice>Active data mode: <ModeBadge mode="supabase" /> <span className="subtle">{import.meta.env.MODE === 'uitest' ? '(in-memory test fakes: nothing is saved anywhere)' : '(your real account, saved to Supabase)'}</span></Notice>
      </section>
    </div>
  );
}
