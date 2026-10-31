import { useState } from 'react';
import { Sun, Moon, Monitor, RotateCcw } from 'lucide-react';
import type { ThemePreference } from '@lovoki/core';
import { store, useAppState, useStatus } from '../store';
import { Avatar, ConfirmDialog, Notice, useToast } from '../ui';

export function Settings() {
  const s = useAppState();
  const { simulateFailures } = useStatus();
  const toast = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const blocked = s.blocked.map((id) => s.profiles[id]!).filter(Boolean);
  const themes: { v: ThemePreference; label: string; icon: typeof Sun }[] = [
    { v: 'system', label: 'System', icon: Monitor }, { v: 'light', label: 'Light', icon: Sun }, { v: 'dark', label: 'Dark', icon: Moon }];

  return (
    <div className="page stack" style={{ gap: 24 }}>
      <div className="page-head" style={{ marginBottom: 0 }}><h1>Settings</h1></div>

      <section className="card card-pad stack" aria-labelledby="appearance">
        <h2 id="appearance">Appearance</h2>
        <div className="segmented" role="group" aria-label="Theme">
          {themes.map((t) => <button key={t.v} aria-pressed={s.theme === t.v} onClick={() => store.setTheme(t.v)}><t.icon size={16} aria-hidden style={{ verticalAlign: -3, marginRight: 6 }} />{t.label}</button>)}
        </div>
      </section>

      <section className="card card-pad" aria-labelledby="privacy">
        <h2 id="privacy" style={{ marginBottom: 8 }}>Privacy</h2>
        <div className="settings-group">
          <label className="switch-row"><span className="grow"><b>Show me in Discover</b><br /><span className="subtle">Turn off to pause dating. Your posts and existing matches stay.</span></span>
            <input type="checkbox" className="switch" checked={s.privacy.datingDiscoverable} onChange={(e) => store.setPrivacy({ datingDiscoverable: e.target.checked })} /></label>
          <label className="switch-row"><span className="grow"><b>Show approximate distance</b><br /><span className="subtle">Shown rounded, like “about 5 km”. Your exact location is never shared.</span></span>
            <input type="checkbox" className="switch" checked={s.privacy.showDistance} onChange={(e) => store.setPrivacy({ showDistance: e.target.checked })} /></label>
          <div className="switch-row"><span className="grow"><b>Default post audience</b><br /><span className="subtle">You can change this on each post.</span></span>
            <div className="segmented" role="group" aria-label="Default post audience">
              <button aria-pressed={s.privacy.socialVisibility === 'public'} onClick={() => store.setPrivacy({ socialVisibility: 'public' })}>Public</button>
              <button aria-pressed={s.privacy.socialVisibility === 'followers'} onClick={() => store.setPrivacy({ socialVisibility: 'followers' })}>Followers</button>
            </div></div>
        </div>
      </section>

      <section className="card card-pad stack" aria-labelledby="blocked">
        <h2 id="blocked">Blocked accounts</h2>
        {blocked.length ? <div className="list">{blocked.map((p) => (
          <div className="list-row" key={p.id}><Avatar profile={p} size={40} /><span className="grow name truncate">{p.name}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => { store.unblock(p.id); toast({ text: `${p.name.split(' ')[0]} is unblocked.` }); }}>Unblock</button></div>
        ))}</div> : <p className="muted">You haven’t blocked anyone. Blocked people can’t see you, and you won’t see them.</p>}
        {s.reports.length > 0 && <p className="subtle">{s.reports.length} {s.reports.length === 1 ? 'report' : 'reports'} saved on this device (demo).</p>}
      </section>

      <section className="card card-pad stack" aria-labelledby="demo">
        <h2 id="demo">Demo tools</h2>
        <Notice>Everything in this prototype is local. Messages, posts, likes and reports are stored in this browser only and never transmitted.</Notice>
        <label className="switch-row"><span className="grow"><b>Simulate failed network actions</b><br /><span className="subtle">Likes, messages, posts and reports will fail so you can see error and retry states.</span></span>
          <input type="checkbox" className="switch" checked={simulateFailures} onChange={(e) => store.setSimulateFailures(e.target.checked)} /></label>
        <button className="btn btn-secondary" style={{ justifySelf: 'start' }} onClick={() => setResetOpen(true)}><RotateCcw size={18} aria-hidden />Reset demo</button>
      </section>
      <ConfirmDialog open={resetOpen} onClose={() => setResetOpen(false)} title="Reset the demo?" confirmLabel="Reset demo"
        body="All local likes, matches, posts, messages, blocks and profile edits will be cleared and the sample data restored."
        onConfirm={() => { void store.resetDemo(); toast({ text: 'Demo reset.' }); }} />
    </div>
  );
}
