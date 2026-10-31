import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  AccountFailure, areaLabelOf, draftsFromAccount, validateAbout, validateBasics, validateDetails, validatePreferences, validatePrivacy,
  type Drafts, type FieldErrors, type ProfileDetails, type VisibilityMap,
} from '@lovoki/core';
import { useReadyAccount } from '../../account/AccountProvider';
import { AboutFields, BasicsFields, PreferenceFields, PrivacyFields } from '../../components/profileFields';
import { PhotoManager } from '../../components/PhotoManager';
import { DETAIL_GROUP_TITLE, DetailsEditor, type DetailsGroup } from '../../profile/DetailsEditor';
import { AvatarEditor } from '../../profile/parts';
import { Notice, useToast } from '../../ui';
import { UnsavedChangesGuard, focusFirstInvalid, useSubmit } from '../../ui/fields';
import { useTitle } from '../../ui/useTitle';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const GROUPS: DetailsGroup[] = ['essentials', 'languages', 'lifestyle', 'family', 'links'];

export function RealEditProfile() {
  useTitle('Edit profile');
  const { account, api, reload } = useReadyAccount();
  const toast = useToast();
  const loc = useLocation();
  const { busy, run } = useSubmit();
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFromAccount(account));
  const [details, setDetails] = useState<ProfileDetails>(account.details);
  const [visibility, setVisibility] = useState<VisibilityMap>(account.visibility);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [fail, setFail] = useState<string | null>(null);
  const base = useMemo(() => draftsFromAccount(account), [account]);
  const changed = {
    basics: !same(drafts.basics, base.basics), about: !same(drafts.about, base.about), preferences: !same(drafts.preferences, base.preferences), privacy: !same(drafts.privacy, base.privacy),
    details: !same(details, account.details) || !same(visibility, account.visibility),
  };
  const dirty = Object.values(changed).some(Boolean);

  // A "Complete your profile" card links to /me/edit#group: scroll to it once.
  useEffect(() => { const id = loc.hash.replace('#', ''); if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 50); }, [loc.hash]);

  const save = () => {
    const er: FieldErrors = {
      ...(changed.basics ? validateBasics(drafts.basics, undefined, true) : {}), ...(changed.about ? validateAbout(drafts.about) : {}),
      ...(changed.preferences ? validatePreferences(drafts.preferences) : {}), ...(changed.privacy ? validatePrivacy(drafts.privacy) : {}),
      ...(changed.details ? validateDetails(details) : {}),
    };
    setErrors(er); setFail(null);
    if (Object.keys(er).length) { focusFirstInvalid(); return; }
    void run(async () => {
      try {
        if (changed.basics) {
          const b = drafts.basics;
          await api.saveBasics({ displayName: b.displayName, dateOfBirth: account.dateOfBirth ?? b.dateOfBirth, pronouns: b.pronouns });
          if (b.username.trim().replace(/^@/, '').toLowerCase() !== account.username) await api.setUsername(b.username);
          if (b.gender && (b.gender !== account.gender || b.genderCustom.trim() !== (account.genderCustom ?? ''))) {
            await api.saveDatingProfile({ gender: b.gender, genderCustom: b.gender === 'self-describe' ? b.genderCustom.trim() : null, showGender: account.showGender, showDistance: account.showDistance });
          }
        }
        if (changed.about) await api.saveAbout(drafts.about);
        if (changed.preferences) await api.savePreferences(drafts.preferences);
        if (changed.privacy) {
          const p = drafts.privacy.place!;
          if (p.id !== null && p.id !== account.place?.id) await api.savePlace(p.id);
          await api.savePrivacy({ areaLabel: areaLabelOf(p), socialVisibility: drafts.privacy.socialVisibility, datingDiscoverable: drafts.privacy.datingDiscoverable });
        }
        if (changed.details) await api.saveDetails(details, visibility, { religionOptIn: details.religion !== null });
        const fresh = await reload();
        setDrafts(draftsFromAccount(fresh)); setDetails(fresh.details); setVisibility(fresh.visibility);
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
      <section className="card card-pad stack" aria-labelledby="s-photos" id="photos"><h2 id="s-photos">Photos</h2>
        <p className="subtle">Photo changes save immediately.</p><PhotoManager account={account} api={api} reload={reload} /></section>
      <section className="card card-pad stack" aria-labelledby="s-avatar" id="avatar"><h2 id="s-avatar">Avatar</h2>
        <AvatarEditor account={account} api={api} reload={reload} /></section>
      <section className="card card-pad stack" aria-labelledby="s-basics"><h2 id="s-basics">Basics</h2>
        <BasicsFields value={drafts.basics} onChange={(basics) => setDrafts({ ...drafts, basics })} errors={errors} dobLocked age={account.age} api={api} currentUsername={account.username} /></section>
      <section className="card card-pad stack" aria-labelledby="s-about" id="about"><h2 id="s-about">About you</h2>
        <AboutFields value={drafts.about} onChange={(about) => setDrafts({ ...drafts, about })} errors={errors} /></section>
      <section className="card card-pad stack" aria-labelledby="s-details" id="details" style={{ gap: 24 }}><h2 id="s-details">More about you</h2>
        <p className="muted">All optional. Each group has its own audience, shown with it. Nothing here is needed to use LOVOKI.</p>
        <DetailsEditor value={details} onChange={setDetails} visibility={visibility} onVisibility={setVisibility} errors={errors} groups={GROUPS} /></section>
      <section className="card card-pad stack" aria-labelledby="s-sens" style={{ gap: 12 }}><h2 id="s-sens">{DETAIL_GROUP_TITLE.sensitive}</h2>
        <DetailsEditor value={details} onChange={setDetails} visibility={visibility} onVisibility={setVisibility} errors={errors} groups={['sensitive']} /></section>
      <section className="card card-pad stack" aria-labelledby="s-pref"><h2 id="s-pref">Dating preferences</h2>
        <PreferenceFields value={drafts.preferences} onChange={(preferences) => setDrafts({ ...drafts, preferences })} errors={errors} /></section>
      <section className="card card-pad stack" aria-labelledby="s-priv"><h2 id="s-priv">Place and privacy</h2>
        <PrivacyFields value={drafts.privacy} onChange={(privacy) => setDrafts({ ...drafts, privacy })} errors={errors} api={api} /></section>
      <div className="savebar" role="region" aria-label="Save changes">
        <span className="muted grow" aria-live="polite">{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
        <Link to="/me" className="btn btn-secondary">{dirty ? 'Cancel' : 'Done'}</Link>
        <button type="submit" className="btn btn-primary" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}
