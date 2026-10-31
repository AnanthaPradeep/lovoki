import { Link } from 'react-router-dom';
import { Pencil, Settings, ShieldCheck } from 'lucide-react';
import { completionPercent } from '@lovoki/core';
import { useReadyAccount } from '../../account/AccountProvider';
import { ProfilePreview } from '../../components/ProfilePreview';
import { VisibilityPanel } from '../../components/profileFields';
import { Notice } from '../../ui';
import { useTitle } from '../../ui/useTitle';

export function RealMe() {
  useTitle('Your profile');
  const { account, api } = useReadyAccount();
  const done = completionPercent(account);
  return (
    <div className="page stack" style={{ gap: 24 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h1>Your profile</h1>
        <div className="row"><Link to="/settings" className="btn btn-ghost"><Settings size={18} aria-hidden />Settings</Link><Link to="/me/edit" className="btn btn-primary"><Pencil size={18} aria-hidden />Edit profile</Link></div>
      </div>
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <div className="row"><b className="grow">Profile {done.percent}% complete</b></div>
        <div className="meter" role="progressbar" aria-valuenow={done.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness"><div style={{ width: `${done.percent}%` }} /></div>
        {done.suggestions.length > 0 && <ul className="muted" style={{ margin: 0, paddingLeft: 20 }}>{done.suggestions.map((m) => <li key={m}>{m}</li>)}</ul>}
      </div>
      <ProfilePreview account={account} api={api} />
      <div className="facts">
        <div className="fact"><ShieldCheck size={18} aria-hidden /><span className="grow">Not verified</span><span className="source">Verification isn’t available yet</span></div>
        <div className="fact"><span className="grow">Age</span><span className="source">Self-declared</span></div>
      </div>
      <VisibilityPanel />
      <Notice>You’re signed in as <b className="break">{account.email}</b>. Your date of birth and email are private.</Notice>
    </div>
  );
}
