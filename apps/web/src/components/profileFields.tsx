import { Check, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  ACCOUNT_LIMITS, ALL_INTENTIONS, ALL_INTERESTS, GENDERS, GENDER_CUSTOM_MAX, INTENTION_LABEL, INTERESTED_IN, PROMPT_QUESTIONS, USERNAME_COOLDOWN_DAYS, todayLocalIso,
  type AboutInput, type AccountApi, type BasicsInput, type FieldErrors, type PreferencesInput, type PrivacyDraft,
} from '@lovoki/core';
import { Counter, FieldError } from '../ui';
import { TextField } from '../ui/fields';
import { PlacePicker } from '../profile/PlacePicker';
import { UsernameField } from '../profile/UsernameField';

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function BasicsFields({ value, onChange, errors, dobLocked, age, api, currentUsername, usernameLocked, consent }: {
  value: BasicsInput; onChange: (v: BasicsInput) => void; errors: FieldErrors; dobLocked?: boolean; age?: number | null;
  api: Pick<AccountApi, 'checkUsername'>; currentUsername: string | null; usernameLocked?: boolean;
  /** Shown only while the terms haven't been accepted. */
  consent?: { agree: boolean; marketing: boolean; onAgree: (v: boolean) => void; onMarketing: (v: boolean) => void };
}) {
  const set = <K extends keyof BasicsInput>(k: K, v: BasicsInput[K]) => onChange({ ...value, [k]: v });
  return (
    <>
      {usernameLocked ? (
        <div className="field"><span className="label">Username</span><p className="break">@{currentUsername}</p>
          <span className="hint">You can change your username once every {USERNAME_COOLDOWN_DAYS} days. The old one is held for {USERNAME_COOLDOWN_DAYS} days so nobody else can take it.</span></div>
      ) : (
        <UsernameField api={api} value={value.username} onChange={(v) => set('username', v)} error={errors.username} current={currentUsername}
          hint={currentUsername ? `You can change it once every ${USERNAME_COOLDOWN_DAYS} days.` : undefined} />
      )}
      <TextField id="displayName" name="displayName" label="Display name" autoComplete="nickname" value={value.displayName}
        onChange={(e) => set('displayName', e.target.value)} error={errors.displayName} hint="The name people see on your profile." />
      {dobLocked ? (
        <div className="field"><span className="label">Age</span><p>{age ?? 'Not set'}</p>
          <span className="hint">Your date of birth is private and can’t be changed after setup is complete. Others only ever see your age.</span></div>
      ) : (
        <TextField id="dateOfBirth" name="bday" label="Date of birth" type="date" autoComplete="bday" min="1900-01-01" max={todayLocalIso()}
          value={value.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} error={errors.dateOfBirth}
          hint="Private. LOVOKI is for adults 18 and over, and others only see your age. Your age is self-declared, not verified." />
      )}
      <fieldset className="field" data-invalid={!!errors.gender} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>Your gender</legend>
        <div className="radio-cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          {GENDERS.map((g) => (
            <label key={g.id} className="radio-card" style={{ minHeight: 44, alignItems: 'center' }}>
              <input type="radio" name="gender" checked={value.gender === g.id} aria-invalid={!!errors.gender} onChange={() => set('gender', g.id)} />{g.label}</label>
          ))}
        </div>
        {value.gender === 'self-describe' && (
          <TextField id="genderCustom" name="genderCustom" label="How do you describe your gender?" maxLength={GENDER_CUSTOM_MAX} value={value.genderCustom} onChange={(e) => set('genderCustom', e.target.value)} error={errors.genderCustom}
            hint="Shown on your profile unless you hide your gender in Settings. For matching, it counts as non-binary." />
        )}
        <FieldError id="gender-err">{errors.gender}</FieldError>
        <span className="hint">Used to match people by who each of you wants to meet. You choose whether it’s shown on your profile.</span>
      </fieldset>
      <TextField id="pronouns" name="pronouns" label={<>Pronouns <span className="subtle">(optional)</span></>} value={value.pronouns}
        onChange={(e) => set('pronouns', e.target.value)} error={errors.pronouns} />
      {consent && (
        <div className="stack" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 12, alignItems: 'flex-start', minHeight: 44 }} data-invalid={!!errors.consent}>
            <input type="checkbox" name="agree" checked={consent.agree} onChange={(e) => consent.onAgree(e.target.checked)} aria-invalid={!!errors.consent} style={{ marginTop: 4, width: 20, height: 20, flex: 'none' }} />
            <span>I’m 18 or over, and I accept the <Link to="/terms" target="_blank" rel="noopener">Terms</Link> and <Link to="/privacy" target="_blank" rel="noopener">Privacy Policy</Link> <span className="subtle">(drafts)</span>.</span>
          </label>
          <FieldError id="consent-err">{errors.consent}</FieldError>
          <label className="row" style={{ gap: 12, alignItems: 'flex-start', minHeight: 44 }}>
            <input type="checkbox" name="marketing" checked={consent.marketing} onChange={(e) => consent.onMarketing(e.target.checked)} style={{ marginTop: 4, width: 20, height: 20, flex: 'none' }} />
            <span>Send me product news by email <span className="subtle">(optional, off by default)</span>.</span>
          </label>
        </div>
      )}
    </>
  );
}

export function AboutFields({ value, onChange, errors }: { value: AboutInput; onChange: (v: AboutInput) => void; errors: FieldErrors }) {
  const used = value.prompts.map((p) => p.question);
  const setPrompt = (i: number, patch: Partial<{ question: string; answer: string }>) => onChange({ ...value, prompts: value.prompts.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <>
      <div className="field" data-invalid={!!errors.bio}>
        <label htmlFor="bio">Bio <span className="subtle">(optional)</span></label>
        <textarea id="bio" className="textarea" value={value.bio} aria-invalid={!!errors.bio} aria-describedby={errors.bio ? 'bio-err' : undefined}
          onChange={(e) => onChange({ ...value, bio: e.target.value })} />
        <div className="row"><span className="grow"><FieldError id="bio-err">{errors.bio}</FieldError></span><Counter value={value.bio.length} max={ACCOUNT_LIMITS.bio} /></div>
      </div>
      <div className="field" data-invalid={!!errors.interests}>
        <span className="label" id="interests-label">Interests <span className="subtle">({value.interests.length}/{ACCOUNT_LIMITS.interestsMax})</span></span>
        <div className="chips" role="group" aria-labelledby="interests-label">
          {ALL_INTERESTS.map((i) => (
            <button type="button" key={i} className="chip chip-toggle" aria-pressed={value.interests.includes(i)}
              onClick={() => onChange({ ...value, interests: toggle(value.interests, i) })}>{i}</button>
          ))}
        </div>
        <FieldError id="interests-err">{errors.interests}</FieldError>
      </div>
      <div className="stack" style={{ gap: 16 }}>
        <span className="label">Prompts <span className="subtle">(optional, up to {ACCOUNT_LIMITS.prompts})</span></span>
        {value.prompts.map((p, i) => (
          <div className="field" key={i} data-invalid={!!errors[`prompt${i}`]}>
            <div className="row">
              <label className="sr-only" htmlFor={`pq-${i}`}>Prompt {i + 1}</label>
              <select id={`pq-${i}`} className="select grow" value={p.question} onChange={(e) => setPrompt(i, { question: e.target.value })}>
                {PROMPT_QUESTIONS.map((q) => <option key={q} value={q} disabled={q !== p.question && used.includes(q)}>{q}</option>)}
              </select>
              <button type="button" className="icon-btn" aria-label={`Remove prompt ${i + 1}`} onClick={() => onChange({ ...value, prompts: value.prompts.filter((_, j) => j !== i) })}><Trash2 size={18} aria-hidden /></button>
            </div>
            <label className="sr-only" htmlFor={`pa-${i}`}>Answer to prompt {i + 1}</label>
            <textarea id={`pa-${i}`} className="textarea" style={{ minHeight: 72 }} value={p.answer} aria-invalid={!!errors[`prompt${i}`]}
              aria-describedby={errors[`prompt${i}`] ? `pe-${i}` : undefined} onChange={(e) => setPrompt(i, { answer: e.target.value })} />
            <div className="row"><span className="grow"><FieldError id={`pe-${i}`}>{errors[`prompt${i}`]}</FieldError></span><Counter value={p.answer.length} max={ACCOUNT_LIMITS.answer} /></div>
          </div>
        ))}
        {value.prompts.length < ACCOUNT_LIMITS.prompts && (
          <button type="button" className="btn btn-secondary" style={{ justifySelf: 'start' }}
            onClick={() => onChange({ ...value, prompts: [...value.prompts, { question: PROMPT_QUESTIONS.find((q) => !used.includes(q))!, answer: '' }] })}><Plus size={18} aria-hidden />Add a prompt</button>
        )}
      </div>
    </>
  );
}

const DISTANCES = [5, 10, 25, 50, 100, 250];

export function PreferenceFields({ value, onChange, errors }: { value: PreferencesInput; onChange: (v: PreferencesInput) => void; errors: FieldErrors }) {
  const all = INTERESTED_IN.every((o) => value.interestedIn.includes(o.id));
  return (
    <>
      <fieldset className="field" data-invalid={!!errors.intention} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>What are you looking for?</legend>
        <div className="stack" style={{ gap: 8 }}>
          {ALL_INTENTIONS.map((i) => (
            <label key={i} className="radio-card"><input type="radio" name="intention" checked={value.intention === i} aria-invalid={!!errors.intention}
              onChange={() => onChange({ ...value, intention: i })} />{INTENTION_LABEL[i]}</label>
          ))}
        </div>
        <FieldError id="intention-err">{errors.intention}</FieldError>
      </fieldset>
      <fieldset className="field" data-invalid={!!errors.interestedIn} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>Who would you like to meet?</legend>
        <div className="chips">
          {INTERESTED_IN.map((o) => (
            <label key={o.id} className="radio-card" style={{ alignItems: 'center' }}>
              <input type="checkbox" checked={value.interestedIn.includes(o.id)} aria-invalid={!!errors.interestedIn}
                onChange={() => onChange({ ...value, interestedIn: toggle(value.interestedIn, o.id) })} />{o.label}</label>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...value, interestedIn: all ? [] : INTERESTED_IN.map((o) => o.id) })}>{all ? 'Clear all' : 'Select everyone'}</button>
        </div>
        <FieldError id="interestedIn-err">{errors.interestedIn}</FieldError>
      </fieldset>
      <div className="field" data-invalid={!!errors.ageRange}>
        <span className="label" id="age-range-label">Age range <span className="subtle">(adults only, 18 to 99)</span></span>
        <div className="range-row" role="group" aria-labelledby="age-range-label">
          <div className="field"><label htmlFor="ageMin" className="sr-only">Minimum age</label>
            <input id="ageMin" className="input" type="number" inputMode="numeric" min={18} max={99} value={Number.isNaN(value.ageMin) ? '' : value.ageMin} aria-invalid={!!errors.ageRange}
              onChange={(e) => onChange({ ...value, ageMin: e.target.value === '' ? NaN : Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="ageMax" className="sr-only">Maximum age</label>
            <input id="ageMax" className="input" type="number" inputMode="numeric" min={18} max={99} value={Number.isNaN(value.ageMax) ? '' : value.ageMax} aria-invalid={!!errors.ageRange}
              onChange={(e) => onChange({ ...value, ageMax: e.target.value === '' ? NaN : Number(e.target.value) })} /></div>
        </div>
        <FieldError id="ageRange-err">{errors.ageRange}</FieldError>
      </div>
      <div className="field" data-invalid={!!errors.maxDistanceKm}>
        <label htmlFor="maxDistance">Distance <span className="subtle">(optional)</span></label>
        <select id="maxDistance" className="select" value={value.maxDistanceKm ?? ''} onChange={(e) => onChange({ ...value, maxDistanceKm: e.target.value === '' ? null : Number(e.target.value) })}>
          <option value="">No preference</option>
          {DISTANCES.map((d) => <option key={d} value={d}>Within {d} km</option>)}
        </select>
        <span className="hint">Saved for later. Distance-based discovery isn’t available yet, and this version never uses your device location.</span>
      </div>
    </>
  );
}

export function PrivacyFields({ value, onChange, errors, api }: { value: PrivacyDraft; onChange: (v: PrivacyDraft) => void; errors: FieldErrors; api: Pick<AccountApi, 'searchPlaces' | 'nearestPlaces'> }) {
  return (
    <>
      <PlacePicker api={api} value={value.place} onChange={(place) => onChange({ ...value, place })} error={errors.place} />
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>Who can see your profile and posts</legend>
        <div className="radio-cards">
          <label className="radio-card" style={{ minHeight: 44 }}><input type="radio" name="social" checked={value.socialVisibility === 'public'} onChange={() => onChange({ ...value, socialVisibility: 'public' })} /><span>Anyone on LOVOKI<small>Your profile is visible to everyone.</small></span></label>
          <label className="radio-card" style={{ minHeight: 44 }}><input type="radio" name="social" checked={value.socialVisibility === 'followers'} onChange={() => onChange({ ...value, socialVisibility: 'followers' })} /><span>Followers only<small>Hidden from people who don’t follow you.</small></span></label>
        </div>
      </fieldset>
      <label className="switch-row">
        <span className="grow"><b>Show me in Discover</b><br /><span className="subtle">Separate from the setting above. It starts off: nobody sees you in Discover until you turn it on. Turn off any time to pause dating.</span></span>
        <input type="checkbox" className="switch" checked={value.datingDiscoverable} onChange={(e) => onChange({ ...value, datingDiscoverable: e.target.checked })} />
      </label>
      <VisibilityPanel />
    </>
  );
}

export function VisibilityPanel() {
  const row = (ok: boolean, text: string) => <li className="row" style={{ alignItems: 'flex-start', gap: 8 }}><Check size={16} aria-hidden style={{ marginTop: 3, flex: 'none', opacity: ok ? 1 : 0.35 }} /><span>{text}</span></li>;
  return (
    <div className="card card-pad stack" style={{ gap: 12, boxShadow: 'none' }}>
      <h2 style={{ fontSize: 'var(--fs-label)' }}>What others can see</h2>
      <ul className="stack" style={{ gap: 6, listStyle: 'none', padding: 0, margin: 0 }}>
        {row(true, 'Your display name, age, pronouns, bio, interests, prompts and photos')}
        {row(true, 'Your city (never a map pin), a distance range, and what you’re looking for')}
        {row(true, 'Optional details only if you add them, each with its own audience')}
        {row(false, 'Never shown: your email, your date of birth, your exact location, who liked you')}
      </ul>
      <p className="subtle">These choices are saved and enforced by the database, not just by this screen.</p>
    </div>
  );
}
