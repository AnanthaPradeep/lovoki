import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import {
  AccountFailure, STEPS, TERMS_VERSION, areaLabelOf, draftsFromAccount, isStep, missingRequired, resumeStep, stepIndex,
  validateBasics, validatePreferences, validatePrivacy, type Drafts, type FieldErrors, type Step,
  type Gender,
} from '@lovoki/core';
import { useAuth } from '../../auth/AuthProvider';
import { useReadyAccount } from '../../account/AccountProvider';
import { BasicsFields, PreferenceFields, PrivacyFields } from '../../components/profileFields';
import { PhotoManager } from '../../components/PhotoManager';
import { ProfilePreview } from '../../components/ProfilePreview';
import { ModeBadge } from '../../components/ModeBadge';
import { FieldError, Notice, useToast } from '../../ui';
import { focusFirstInvalid, useSubmit } from '../../ui/fields';
import { useTitle } from '../../ui/useTitle';

const COPY: Record<Step, { title: string; body: string }> = {
  basics: { title: 'The basics', body: 'Pick a username and tell us who you are. Your date of birth stays private: other people only see your age.' },
  preferences: { title: 'Who you’d like to meet', body: 'This shapes who you see. Only adults can use LOVOKI, so every age range starts at 18.' },
  photos: { title: 'Add your photos', body: 'Add at least one clear photo of you. The first photo is your main one.' },
  privacy: { title: 'Place and privacy', body: 'Choose your city and who can see you. You can change this any time.' },
  review: { title: 'Review your profile', body: 'This is how your profile will read to others. Everything else is optional and can wait.' },
};

/** A field's error goes away as soon as that field is edited, so a stale message never hides the live hint. */
function dropChanged(errors: FieldErrors, before: object, after: object): FieldErrors {
  const next = { ...errors }; const a = before as Record<string, unknown>; const b = after as Record<string, unknown>;
  for (const k of Object.keys(b)) if (a[k] !== b[k]) delete next[k];
  return next;
}

export function OnboardingRedirect() {
  const { account } = useReadyAccount();
  return <Navigate to={`/onboarding/${resumeStep(account) ?? 'basics'}`} replace />;
}

export function Onboarding() {
  const { step: param = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { signOut } = useAuth();
  const { account, api, reload } = useReadyAccount();
  const { busy, run } = useSubmit();
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFromAccount(account));
  const [agree, setAgree] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [fail, setFail] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const resume = resumeStep(account) ?? 'basics';
  const valid = isStep(param) && stepIndex(param) <= stepIndex(resume);
  const step: Step = valid ? (param as Step) : resume;
  const idx = stepIndex(step);
  useTitle(`${COPY[step].title} (step ${idx + 1} of ${STEPS.length})`);
  useEffect(() => { setErrors({}); setFail(null); heading.current?.focus({ preventScroll: true }); }, [step]);
  if (!valid) return <Navigate to={`/onboarding/${resume}`} replace />;

  const needsConsent = !account.consent;
  const validate = (s: Step): FieldErrors => {
    if (s === 'basics') { const e = validateBasics(drafts.basics); if (needsConsent && !agree) e.consent = 'Confirm you’re 18 or over and accept the terms to continue.'; return e; }
    if (s === 'preferences') return validatePreferences(drafts.preferences);
    if (s === 'privacy') return validatePrivacy(drafts.privacy);
    if (s === 'photos') return account.photos.length ? {} : { photos: 'Add at least one photo to continue.' };
    return {};
  };

  const save = async (s: Step) => {
    if (s === 'basics') {
      const b = drafts.basics;
      await api.saveBasics({ displayName: b.displayName, dateOfBirth: b.dateOfBirth, pronouns: b.pronouns });
      await api.setUsername(b.username.trim().replace(/^@/, '').toLowerCase());
      await api.saveDatingProfile({ gender: b.gender as Gender, genderCustom: b.gender === 'self-describe' ? b.genderCustom.trim() : null, showGender: account.showGender, showDistance: account.showDistance });
      if (needsConsent) await api.recordConsent(TERMS_VERSION, marketing);
    } else if (s === 'preferences') await api.savePreferences(drafts.preferences);
    else if (s === 'privacy') {
      const p = drafts.privacy.place!;
      if (p.id !== null && p.id !== account.place?.id) await api.savePlace(p.id);
      await api.savePrivacy({ areaLabel: areaLabelOf(p), socialVisibility: drafts.privacy.socialVisibility, datingDiscoverable: drafts.privacy.datingDiscoverable });
    }
  };
  const handleFail = (e: unknown) => {
    const f = e instanceof AccountFailure ? e : null;
    if (f?.code === 'under_18') { setErrors({ dateOfBirth: f.message }); focusFirstInvalid(); return; }
    if (f?.code === 'invalid' && /username/i.test(f.message)) { setErrors({ username: f.message }); focusFirstInvalid(); return; }
    setFail(f ? (f.code === 'network' ? `${f.message} Your answers are still here.` : f.message) : 'Something went wrong. Try again.');
  };

  const onContinue = () => {
    const er = validate(step);
    setErrors(er); setFail(null);
    if (Object.keys(er).length) { focusFirstInvalid(); return; }
    const next = STEPS[idx + 1]!.id;
    void run(async () => {
      try { await save(step); await api.setStep(next); await reload(); nav(`/onboarding/${next}`); }
      catch (e) { handleFail(e); }
    });
  };
  const onComplete = () => {
    setFail(null);
    void run(async () => {
      try { await api.completeOnboarding(); await reload(); toast({ text: 'Your profile is set up.' }); nav('/discover', { replace: true }); }
      catch (e) { await reload().catch(() => undefined); handleFail(e); }
    });
  };

  const missing = missingRequired(account);
  return (
    <div className="onb">
      <header className="onb-top">
        <span className="wordmark" style={{ padding: 0 }}>LOVOKI</span><ModeBadge mode="supabase" /><span className="grow" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>Log out</button>
      </header>
      <nav aria-label="Setup progress" className="onb-steps">
        <p className="onb-count" aria-hidden>Step {idx + 1} of {STEPS.length}</p>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.id} aria-current={i === idx ? 'step' : undefined} data-state={i < idx ? 'done' : i === idx ? 'current' : 'todo'}>
              <span className="onb-dot">{i < idx ? <Check size={14} aria-hidden /> : i + 1}</span><span className="onb-label">{s.label}</span>
              {i < idx && <span className="sr-only"> (completed)</span>}
            </li>
          ))}
        </ol>
      </nav>
      <main id="main" className="onb-card card">
        <h1 ref={heading} tabIndex={-1} style={{ outline: 'none' }}>{COPY[step].title}</h1>
        <p className="muted" style={{ marginTop: 6 }}>{COPY[step].body}</p>
        <form className="stack" style={{ marginTop: 24, gap: 24 }} noValidate onSubmit={(e) => { e.preventDefault(); if (step === 'review') onComplete(); else onContinue(); }}>
          {fail && <Notice tone="error" action={<button type="button" className="btn btn-secondary btn-sm" onClick={step === 'review' ? onComplete : onContinue} disabled={busy}>Try again</button>}>{fail}</Notice>}
          {step === 'basics' && <BasicsFields value={drafts.basics} onChange={(basics) => { setDrafts({ ...drafts, basics }); setErrors((er) => dropChanged(er, drafts.basics, basics)); }} errors={errors} api={api} currentUsername={account.username}
            consent={needsConsent ? { agree, marketing, onAgree: (v: boolean) => { setAgree(v); setErrors((er) => dropChanged(er, { consent: 0 }, { consent: 1 })); }, onMarketing: setMarketing } : undefined} />}
          {step === 'preferences' && <PreferenceFields value={drafts.preferences} onChange={(preferences) => setDrafts({ ...drafts, preferences })} errors={errors} />}
          {step === 'photos' && <>
            <PhotoManager account={account} api={api} reload={reload} />
            <span className="field" data-invalid={!!errors.photos}><FieldError id="photos-err">{errors.photos}</FieldError></span></>}
          {step === 'privacy' && <PrivacyFields value={drafts.privacy} onChange={(privacy) => setDrafts({ ...drafts, privacy })} errors={errors} api={api} />}
          {step === 'review' && <>
            {missing.length > 0 && <Notice tone="warning">Still needed: {missing.map((m, i) => <span key={m.field}>{i > 0 && ', '}<Link to={`/onboarding/${m.step}`}>{m.label.toLowerCase()}</Link></span>)}.</Notice>}
            <ProfilePreview account={account} api={api} />
            <Notice>Age is self-declared and not verified. Bio, interests, prompts and the rest are optional: add them any time from your profile.</Notice></>}
          <div className="onb-nav">
            {idx > 0 ? <Link to={`/onboarding/${STEPS[idx - 1]!.id}`} className="btn btn-secondary">Back</Link> : <span />}
            {step === 'review'
              ? <button type="submit" className="btn btn-primary" disabled={busy || missing.length > 0}>{busy ? 'Finishing…' : 'Finish setup'}</button>
              : <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>}
          </div>
        </form>
      </main>
    </div>
  );
}
