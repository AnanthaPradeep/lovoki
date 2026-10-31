import { useState } from 'react';
import { AccountFailure, GENDERS, GENDER_CUSTOM_MAX, areaLabelOf, type Gender, type PlaceHit } from '@lovoki/core';
import { useReadyAccount } from '../account/AccountProvider';
import { Notice, useToast } from '../ui';
import { useSubmit } from '../ui/fields';
import { PlacePicker } from '../profile/PlacePicker';

/** Gender, what others may see, and your city. Nothing here ever uses device location unless you click the button, and nothing about your position is kept. */
export function DatingSettings() {
  const { account, api, reload } = useReadyAccount();
  const toast = useToast();
  const { busy, run } = useSubmit();
  const [custom, setCustom] = useState(account.genderCustom ?? '');

  const save = (patch: Partial<{ gender: Gender; showGender: boolean; showDistance: boolean }>, done: string, label = custom) => run(async () => {
    const gender = patch.gender ?? account.gender;
    if (!gender) { toast({ text: 'Choose your gender first.', tone: 'error' }); return; }
    if (gender === 'self-describe' && !label.trim()) return; // the label field shows the prompt; nothing to save yet
    try {
      await api.saveDatingProfile({ gender, genderCustom: gender === 'self-describe' ? label.trim() : null, showGender: patch.showGender ?? account.showGender, showDistance: patch.showDistance ?? account.showDistance });
      await reload(); toast({ text: done });
    } catch (e) { toast({ text: e instanceof AccountFailure ? e.message : 'Couldn’t save that.', tone: 'error' }); }
  });
  const changePlace = (p: PlaceHit | null) => run(async () => {
    try {
      if (p === null) { await api.clearPlace(); await reload(); toast({ text: 'Your city was removed. Distance no longer applies to you.' }); return; }
      if (p.id === null) return;
      await api.savePlace(p.id);
      await api.savePrivacy({ areaLabel: areaLabelOf(p), socialVisibility: account.socialVisibility, datingDiscoverable: account.datingDiscoverable });
      await reload(); toast({ text: `Your city is saved as ${p.label}.` });
    } catch (e) { toast({ text: e instanceof AccountFailure ? e.message : 'Couldn’t save your city.', tone: 'error' }); }
  });

  return (
    <section className="card card-pad stack" aria-labelledby="dating"><h2 id="dating">Dating profile</h2>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>Your gender</legend>
        <div className="segmented" role="group" aria-label="Your gender" style={{ flexWrap: 'wrap' }}>
          {GENDERS.map((g) => <button type="button" key={g.id} aria-pressed={account.gender === g.id} disabled={busy} onClick={() => void save({ gender: g.id }, 'Gender saved.')}>{g.label}</button>)}
        </div>
        {account.gender === 'self-describe' && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <label className="grow" style={{ minWidth: 200 }}><span className="sr-only">How you describe your gender</span>
              <input className="input" maxLength={GENDER_CUSTOM_MAX} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="How you describe your gender" /></label>
            <button type="button" className="btn btn-secondary" disabled={busy || !custom.trim() || custom.trim() === (account.genderCustom ?? '')} onClick={() => void save({}, 'Saved.')}>Save</button>
          </div>
        )}
        {!account.gender && <span className="hint">Needed for Discover: it matches people by who each of you wants to meet.</span>}
      </fieldset>
      <label className="switch-row"><span className="grow"><b>Show my gender on my profile</b><br /><span className="subtle">You’re still matched by gender; this only hides the label.</span></span>
        <input type="checkbox" className="switch" checked={account.showGender} disabled={busy || !account.gender} onChange={(e) => void save({ showGender: e.target.checked }, 'Saved.')} /></label>
      <PlacePicker api={api} value={account.place} onChange={(p) => void changePlace(p)} label="Your city" />
      <label className="switch-row"><span className="grow"><b>Show my distance range to others</b><br /><span className="subtle">If off, nobody sees how far away you are, and distance filters don’t apply to you.</span></span>
        <input type="checkbox" className="switch" checked={account.showDistance} disabled={busy || !account.gender} onChange={(e) => void save({ showDistance: e.target.checked }, 'Saved.')} /></label>
      <Notice>Likes are private: nobody is told you liked them unless you both do. Turn off “Show me in Discover” above to pause dating; your matches stay.</Notice>
    </section>
  );
}
