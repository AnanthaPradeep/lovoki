import { useState } from 'react';
import { AccountFailure, GENDERS, PLACE_CHOICES, type Gender } from '@lovoki/core';
import { useReadyAccount } from '../account/AccountProvider';
import { Notice, useToast } from '../ui';
import { useSubmit } from '../ui/fields';

/** Gender, what others may see, and an approximate place. Nothing here ever uses device location. */
export function DatingSettings() {
  const { account, api, reload } = useReadyAccount();
  const toast = useToast();
  const { busy, run } = useSubmit();
  const [placeIdx, setPlaceIdx] = useState('');

  const save = (patch: Partial<{ gender: Gender; showGender: boolean; showDistance: boolean }>, done: string) => run(async () => {
    const gender = patch.gender ?? account.gender;
    if (!gender) { toast({ text: 'Choose your gender first.', tone: 'error' }); return; }
    try { await api.saveDatingProfile({ gender, showGender: patch.showGender ?? account.showGender, showDistance: patch.showDistance ?? account.showDistance }); await reload(); toast({ text: done }); }
    catch (e) { toast({ text: e instanceof AccountFailure ? e.message : 'Couldn’t save that.', tone: 'error' }); }
  });
  const savePlace = (i: string) => run(async () => {
    const p = PLACE_CHOICES[Number(i)]; if (!p) return;
    try { await api.savePlace(p); await reload(); setPlaceIdx(''); toast({ text: `Your place is saved as ${p.label}.` }); }
    catch (e) { toast({ text: e instanceof AccountFailure ? e.message : 'Couldn’t save your place.', tone: 'error' }); }
  });
  const clearPlace = () => run(async () => {
    try { await api.clearPlace(); await reload(); toast({ text: 'Your place was removed. Distance no longer applies to you.' }); }
    catch (e) { toast({ text: e instanceof AccountFailure ? e.message : 'Couldn’t remove your place.', tone: 'error' }); }
  });

  return (
    <section className="card card-pad stack" aria-labelledby="dating"><h2 id="dating">Dating profile</h2>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>Your gender</legend>
        <div className="segmented" role="group" aria-label="Your gender">
          {GENDERS.map((g) => <button type="button" key={g.id} aria-pressed={account.gender === g.id} disabled={busy} onClick={() => void save({ gender: g.id }, 'Gender saved.')}>{g.label}</button>)}
        </div>
        {!account.gender && <span className="hint">Needed for Discover: it matches people by who each of you wants to meet.</span>}
      </fieldset>
      <label className="switch-row"><span className="grow"><b>Show my gender on my profile</b><br /><span className="subtle">You’re still matched by gender; this only hides the label.</span></span>
        <input type="checkbox" className="switch" checked={account.showGender} disabled={busy || !account.gender} onChange={(e) => void save({ showGender: e.target.checked }, 'Saved.')} /></label>
      <div className="field">
        <label htmlFor="place">Your city <span className="subtle">(approximate)</span></label>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <select id="place" className="select grow" value={placeIdx} disabled={busy} onChange={(e) => { setPlaceIdx(e.target.value); if (e.target.value !== '') void savePlace(e.target.value); }}>
            <option value="">{account.place ? `Currently: ${account.place.label}` : 'Choose a city'}</option>
            {PLACE_CHOICES.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          </select>
          {account.place && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void clearPlace()}>Remove</button>}
        </div>
        <span className="hint">We never use your device location. Your city is rounded to about 1 km on our servers and is never shown to anyone. Other people only ever see a distance range such as “less than 25 km”.</span>
      </div>
      <label className="switch-row"><span className="grow"><b>Show my distance range to others</b><br /><span className="subtle">If off, nobody sees how far away you are, and distance filters don’t apply to you.</span></span>
        <input type="checkbox" className="switch" checked={account.showDistance} disabled={busy || !account.gender} onChange={(e) => void save({ showDistance: e.target.checked }, 'Saved.')} /></label>
      <Notice>Likes are private: nobody is told you liked them unless you both do. Turn off “Show me in Discover” above to pause dating; your matches stay.</Notice>
    </section>
  );
}
