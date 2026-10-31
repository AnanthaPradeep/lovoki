import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import {
  AccountFailure, STEPS, draftsFromAccount, isStep, missingRequired, resumeStep, stepIndex,
  validateAbout, validateBasics, validatePreferences, validatePrivacy, type Drafts, type FieldErrors, type Step,
} from '@lovoki/core';
import { useAuth } from '../../auth/AuthProvider';
import { useReadyAccount } from '../../account/AccountProvider';
import { AboutFields, BasicsFields, PreferenceFields, PrivacyFields } from '../../components/profileFields';
import { PhotoManager } from '../../components/PhotoManager';
import { ProfilePreview } from '../../components/ProfilePreview';
import { ModeBadge } from '../../components/ModeBadge';
import { FieldError, Notice, useToast } from '../../ui';
import { focusFirstInvalid, useSubmit } from '../../ui/fields';
import { useTitle } from '../../ui/useTitle';

const COPY: Record<Step, { title: string; body: string }> = {
  basics: { title: 'The basics', body: 'Your date of birth stays private. Other people only see your age.' },
  about: { title: 'About you', body: 'Everything here is optional, but a few details make first conversations easier.' },
  preferences: { title: 'Who you’d like to meet', body: 'This shapes who you see. Only adults can use LOVOKI, so every age range starts at 18.' },
  photos: { title: 'Add your photos', body: 'Add at least one clear photo of you. The first photo is your main one.' },
  privacy: { title: 'Location and privacy', body: 'Choose where you are and who can see you. You can change this any time.' },
  review: { title: 'Review your profile', body: 'This is how your profile will read to others.' },
};

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

  const validate = (s: Step): FieldErrors =>
    s === 'basics' ? validateBasics(drafts.basics)
    : s === 'about' ? validateAbout(drafts.about)
    : s === 'preferences' ? validatePreferences(drafts.preferences)
    : s === 'privacy' ? validatePrivacy(drafts.privacy)
    : s === 'photos' ? (account.photos.length ? {} : { photos: 'Add at least one photo to continue.' }) : {};

  const save = async (s: Step) => {
    if (s === 'basics') await api.saveBasics(drafts.basics);
    else if (s === 'about') await api.saveAbout(drafts.about);
    else if (s === 'preferences') await api.savePreferences(drafts.preferences);
    else if (s === 'privacy') await api.savePrivacy(drafts.privacy);
  };
  const handleFail = (e: unknown) => {
    const f = e instanceof AccountFailure ? e : null;
    if (f?.code === 'under_18') { setErrors({ dateOfBirth: f.message }); focusFirstInvalid(); return; }
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
        <button className="btn btn-ghost btn-sm" onClick={() => void signOut()}>Log out</button>
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
          {step === 'basics' && <BasicsFields value={drafts.basics} onChange={(basics) => setDrafts({ ...drafts, basics })} errors={errors} />}
          {step === 'about' && <AboutFields value={drafts.about} onChange={(about) => setDrafts({ ...drafts, about })} errors={errors} />}
          {step === 'preferences' && <PreferenceFields value={drafts.preferences} onChange={(preferences) => setDrafts({ ...drafts, preferences })} errors={errors} />}
          {step === 'photos' && <>
            <PhotoManager account={account} api={api} reload={reload} />
            <span className="field" data-invalid={!!errors.photos}><FieldError id="photos-err">{errors.photos}</FieldError></span></>}
          {step === 'privacy' && <PrivacyFields value={drafts.privacy} onChange={(privacy) => setDrafts({ ...drafts, privacy })} errors={errors} />}
          {step === 'review' && <>
            {missing.length > 0 && <Notice tone="warning">Still needed: {missing.map((m, i) => <span key={m.field}>{i > 0 && ', '}<Link to={`/onboarding/${m.step}`}>{m.label.toLowerCase()}</Link></span>)}.</Notice>}
            <ProfilePreview account={account} api={api} />
            <Notice>Age is self-declared and not verified. Meeting real people isn’t live yet, so completing setup saves your profile and opens the app.</Notice></>}
          <div className="onb-nav">
            {idx > 0 ? <Link to={`/onboarding/${STEPS[idx - 1]!.id}`} className="btn btn-secondary">Back</Link> : <span />}
            {step === 'review'
              ? <button className="btn btn-primary" disabled={busy || missing.length > 0}>{busy ? 'Finishing…' : 'Finish setup'}</button>
              : <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>}
          </div>
        </form>
      </main>
    </div>
  );
}
