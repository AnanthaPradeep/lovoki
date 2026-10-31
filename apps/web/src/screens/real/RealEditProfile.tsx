import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  AccountFailure, draftsFromAccount, validateAbout, validateBasics, validatePreferences, validatePrivacy, type Drafts, type FieldErrors,
} from '@lovoki/core';
import { useReadyAccount } from '../../account/AccountProvider';
import { AboutFields, BasicsFields, PreferenceFields, PrivacyFields } from '../../components/profileFields';
import { PhotoManager } from '../../components/PhotoManager';
import { Notice, useToast } from '../../ui';
import { UnsavedChangesGuard, focusFirstInvalid, useSubmit } from '../../ui/fields';
import { useTitle } from '../../ui/useTitle';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function RealEditProfile() {
  useTitle('Edit profile');
  const { account, api, reload } = useReadyAccount();
  const toast = useToast();
  const { busy, run } = useSubmit();
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFromAccount(account));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [fail, setFail] = useState<string | null>(null);
  const base = useMemo(() => draftsFromAccount(account), [account]);
  const changed = { basics: !same(drafts.basics, base.basics), about: !same(drafts.about, base.about), preferences: !same(drafts.preferences, base.preferences), privacy: !same(drafts.privacy, base.privacy) };
  const dirty = Object.values(changed).some(Boolean);

  const save = () => {
    const er: FieldErrors = {
      ...(changed.basics ? validateBasics(drafts.basics, undefined, true) : {}), ...(changed.about ? validateAbout(drafts.about) : {}),
      ...(changed.preferences ? validatePreferences(drafts.preferences) : {}), ...(changed.privacy ? validatePrivacy(drafts.privacy) : {}),
    };
    setErrors(er); setFail(null);
    if (Object.keys(er).length) { focusFirstInvalid(); return; }
    void run(async () => {
      try {
        if (changed.basics) await api.saveBasics({ ...drafts.basics, dateOfBirth: account.dateOfBirth ?? drafts.basics.dateOfBirth });
        if (changed.about) await api.saveAbout(drafts.about);
        if (changed.preferences) await api.savePreferences(drafts.preferences);
        if (changed.privacy) await api.savePrivacy(drafts.privacy);
        const fresh = await reload();
        setDrafts(draftsFromAccount(fresh));
        toast({ text: 'Changes saved.' });
      } catch (e) {
        await reload().catch(() => undefined); // some sections may have saved before the failure
        setFail(e instanceof AccountFailure ? (e.code === 'network' ? `${e.message} Your edits are still here.` : e.message) : 'Couldn’t save. Try again.');
      }
    });
  };

  return (
    <form className="page stack" style={{ gap: 24 }} onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
      <UnsavedChangesGuard dirty={dirty} />
      <div><Link to="/me" className="back"><ArrowLeft size={18} aria-hidden />Your profile</Link><h1 style={{ fontSize: 'var(--fs-heading)' }}>Edit profile</h1></div>
      {Object.keys(errors).length > 0 && <Notice tone="error">Fix {Object.keys(errors).length} {Object.keys(errors).length === 1 ? 'field' : 'fields'} before saving.</Notice>}
      {fail && <Notice tone="error" action={<button type="button" className="btn btn-secondary btn-sm" onClick={save} disabled={busy}>Try again</button>}>{fail}</Notice>}
      <section className="card card-pad stack" aria-labelledby="s-photos"><h2 id="s-photos">Photos</h2>
        <p className="subtle">Photo changes save immediately.</p><PhotoManager account={account} api={api} reload={reload} /></section>
      <section className="card card-pad stack" aria-labelledby="s-basics"><h2 id="s-basics">Basics</h2>
        <BasicsFields value={drafts.basics} onChange={(basics) => setDrafts({ ...drafts, basics })} errors={errors} dobLocked age={account.age} /></section>
      <section className="card card-pad stack" aria-labelledby="s-about"><h2 id="s-about">About you</h2>
        <AboutFields value={drafts.about} onChange={(about) => setDrafts({ ...drafts, about })} errors={errors} /></section>
      <section className="card card-pad stack" aria-labelledby="s-pref"><h2 id="s-pref">Dating preferences</h2>
        <PreferenceFields value={drafts.preferences} onChange={(preferences) => setDrafts({ ...drafts, preferences })} errors={errors} /></section>
      <section className="card card-pad stack" aria-labelledby="s-priv"><h2 id="s-priv">Location and privacy</h2>
        <PrivacyFields value={drafts.privacy} onChange={(privacy) => setDrafts({ ...drafts, privacy })} errors={errors} /></section>
      <div className="savebar" role="region" aria-label="Save changes">
        <span className="muted grow" aria-live="polite">{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
        <Link to="/me" className="btn btn-secondary">{dirty ? 'Cancel' : 'Done'}</Link>
        <button className="btn btn-primary" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}
