import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Monitor, Moon, Sun, LogOut } from 'lucide-react';
import { AccountFailure, SocialFailure, type BlockedPerson, type ThemePreference } from '@lovoki/core';
import { useSocial } from '../../social/SocialProvider';
import { LoadError } from '../../social/parts';
import { DatingSettings } from '../../dating/DatingSettings';
import { AccountSecurity } from '../../profile/AccountSecurity';
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
  const saveSocial = (patch: Partial<{ allowComments: 'everyone' | 'followers' | 'nobody'; showFollowerCounts: boolean }>) => run(async () => {
    try { await api.saveSocialSettings({ allowComments: account.allowComments, showFollowerCounts: account.showFollowerCounts, ...patch }); await reload(); toast({ text: 'Saved.' }); }
    catch (e) { toast({ text: e instanceof AccountFailure ? e.message : 'Couldn’t save that setting.', tone: 'error' }); }
  });
  const saveMarketing = (on: boolean) => run(async () => {
    try { await api.setMarketingConsent(on); await reload(); toast({ text: on ? 'You’ll get product news by email.' : 'No product emails. Account emails (confirmations, resets) still arrive.' }); }
    catch (e) { toast({ text: e instanceof AccountFailure ? e.message : 'Couldn’t save that setting.', tone: 'error' }); }
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
          <label className="switch-row"><span className="grow"><b>Show me in Discover</b><br /><span className="subtle">Turn off to pause dating: you vanish from Discover at once and can’t like anyone. Matches stay.</span></span>
            <input type="checkbox" className="switch" checked={account.datingDiscoverable} disabled={busy} onChange={(e) => void savePrivacy({ datingDiscoverable: e.target.checked })} /></label>
          <div className="switch-row"><span className="grow"><b>Who can see your profile and posts</b><br /><span className="subtle">Social visibility.</span></span>
            <div className="segmented" role="group" aria-label="Social visibility">
              <button aria-pressed={account.socialVisibility === 'public'} disabled={busy} onClick={() => void savePrivacy({ socialVisibility: 'public' })}>Public</button>
              <button aria-pressed={account.socialVisibility === 'followers'} disabled={busy} onClick={() => void savePrivacy({ socialVisibility: 'followers' })}>Followers</button>
            </div></div>
        </div>
      </section>
      <section className="card card-pad" aria-labelledby="social"><h2 id="social" style={{ marginBottom: 8 }}>Posts and followers</h2>
        <div className="settings-group">
          <div className="switch-row"><label htmlFor="allow-comments" className="grow"><b>Who can comment on your posts</b><br /><span className="subtle">You can always comment on your own posts and delete any comment on them.</span></label>
            <select id="allow-comments" className="select" style={{ width: 'auto' }} value={account.allowComments} disabled={busy} onChange={(e) => void saveSocial({ allowComments: e.target.value as 'everyone' | 'followers' | 'nobody' })}>
              <option value="everyone">Everyone who can see them</option><option value="followers">Only my followers</option><option value="nobody">Nobody</option></select></div>
          <label className="switch-row"><span className="grow"><b>Show follower and following counts</b><br /><span className="subtle">You always see your own counts.</span></span>
            <input type="checkbox" className="switch" checked={account.showFollowerCounts} disabled={busy} onChange={(e) => void saveSocial({ showFollowerCounts: e.target.checked })} /></label>
        </div>
      </section>
      <DatingSettings />
      <BlockedAccounts />
      <AccountSecurity />
      <section className="card card-pad stack" aria-labelledby="consent-h"><h2 id="consent-h">Terms and email</h2>
        <p className="muted">You accepted version <code>{account.consent?.termsVersion ?? 'none'}</code> of the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link> (both drafts).</p>
        <label className="switch-row"><span className="grow"><b>Product news by email</b><br /><span className="subtle">Off unless you turn it on. Confirmation and password emails aren’t affected.</span></span>
          <input type="checkbox" className="switch" checked={account.consent?.marketing ?? false} disabled={busy || !account.consent} onChange={(e) => void saveMarketing(e.target.checked)} /></label>
      </section>
      <section className="card card-pad stack" aria-labelledby="account"><h2 id="account">Account</h2>
        <p className="muted">Signed in as <b className="break">{account.email}</b></p>
        <button className="btn btn-secondary" style={{ justifySelf: 'start' }} onClick={() => void logout()}><LogOut size={18} aria-hidden />Log out</button>
      </section>
      <section className="card card-pad stack" aria-labelledby="soon"><h2 id="soon">Not available yet</h2>
        <ul className="muted stack" style={{ gap: 6, margin: 0, paddingLeft: 20 }}>
          <li>Dating-side blocking and unmatching: with matching</li>
          <li>Notification preferences: with messaging</li>
          <li>Identity or photo verification: not built, so no profile is shown as verified</li>
          <li>Account deletion and data export: before public release</li>
        </ul>
        <Notice>Active data mode: <ModeBadge mode="supabase" /> <span className="subtle">{import.meta.env.MODE === 'uitest' ? '(in-memory test fakes: nothing is saved anywhere)' : '(your real account, saved to Supabase)'}</span></Notice>
      </section>
    </div>
  );
}

function BlockedAccounts() {
  const { api } = useSocial();
  const toast = useToast();
  const [people, setPeople] = useState<BlockedPerson[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); setPeople(null); api.blocked().then(setPeople).catch((e) => setErr(e instanceof SocialFailure ? e.message : 'Couldn’t load blocked accounts.')); }, [api]);
  useEffect(() => { load(); }, [load]);
  const unblock = async (p: BlockedPerson) => {
    if (busy) return;
    setBusy(p.userId);
    try { await api.unblock(p.userId); setPeople((cur) => (cur ?? []).filter((x) => x.userId !== p.userId)); toast({ text: `${p.displayName} is unblocked. Earlier follows aren’t restored.` }); }
    catch (e) { toast({ text: e instanceof SocialFailure ? e.message : 'Couldn’t unblock.', tone: 'error' }); }
    finally { setBusy(null); }
  };
  return (
    <section className="card card-pad stack" aria-labelledby="blocked"><h2 id="blocked">Blocked accounts</h2>
      <p className="muted">Blocked people can’t see your profile, posts or comments, and you can’t see theirs. They aren’t told.</p>
      {err && <LoadError message={err} onRetry={load} />}
      {!err && people === null && <div className="skeleton" style={{ height: 48 }} aria-busy="true" aria-label="Loading blocked accounts" />}
      {people?.length === 0 && <p className="subtle">You haven’t blocked anyone.</p>}
      {people && people.length > 0 && (
        <ul className="list" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Blocked accounts">
          {people.map((p) => (
            <li key={p.userId} className="list-row" style={{ flexWrap: 'wrap' }}>
              <span className="name grow break">{p.displayName}</span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => void unblock(p)}>Unblock</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
