import { useId } from 'react';
import { EyeOff } from 'lucide-react';
import {
  DETAIL_LIMITS, DIET, DRINKING, EDUCATION, EXERCISE, HAS_KIDS, LANGUAGES, PETS, RELIGION, SMOKING, STRUCTURE, VISIBILITY_LABEL, WANTS_KIDS, visibilityOf,
  type DetailErrors, type Option, type ProfileDetails, type Visibility, type VisibilityKey, type VisibilityMap,
} from '@lovoki/core';
import { Notice } from '../ui';
import { TextField } from '../ui/fields';

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const INSTAGRAM_AUDIENCES: Visibility[] = ['M', 'F', 'P', 'X'];
const ALL_AUDIENCES: Visibility[] = ['P', 'F', 'M', 'X'];

/** Who can see a group of details. Every optional group has one; the default is shown and can be changed any time. */
export function VisibilitySelect({ id, label, value, onChange, options = ALL_AUDIENCES }: { id: string; label: string; value: Visibility; onChange: (v: Visibility) => void; options?: Visibility[] }) {
  return (
    <div className="field" style={{ gap: 4 }}>
      <label htmlFor={id} className="subtle" style={{ fontWeight: 600 }}>{label}</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value as Visibility)}>
        {options.map((v) => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
      </select>
    </div>
  );
}

function Pick({ id, label, list, value, onChange, error }: { id: string; label: string; list: Option[]; value: string | null; onChange: (v: string | null) => void; error?: string }) {
  return (
    <div className="field" data-invalid={!!error}>
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} aria-invalid={!!error}>
        <option value="">Prefer not to say</option>
        {list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
}

export type DetailsGroup = 'essentials' | 'languages' | 'lifestyle' | 'family' | 'links' | 'sensitive';
export const DETAIL_GROUP_TITLE: Record<DetailsGroup, string> = {
  essentials: 'Height, work and education', languages: 'Languages', lifestyle: 'Lifestyle', family: 'Kids and relationship style', links: 'Links', sensitive: 'Religion (sensitive, optional)',
};

/**
 * Every optional field in one editor. All of it is optional; nothing blocks. Each group has its own audience.
 * Religion is sensitive: it needs a deliberate opt-in, stays hidden by default, is display-only, and is never a filter.
 */
export function DetailsEditor({ value, onChange, visibility, onVisibility, errors, groups }: {
  value: ProfileDetails; onChange: (d: ProfileDetails) => void; visibility: VisibilityMap; onVisibility: (m: VisibilityMap) => void; errors: DetailErrors; groups?: DetailsGroup[];
}) {
  const uid = useId();
  const set = <K extends keyof ProfileDetails>(k: K, v: ProfileDetails[K]) => onChange({ ...value, [k]: v });
  const vis = (key: VisibilityKey, label: string, options?: Visibility[]) => (
    <VisibilitySelect id={`${uid}-vis-${key}`} label={label} value={visibilityOf(visibility, key)} onChange={(v) => onVisibility({ ...visibility, [key]: v })} options={options} />);
  const show = (g: DetailsGroup) => !groups || groups.includes(g);

  return (
    <div className="stack" style={{ gap: 28 }}>
      {show('essentials') && (
        <fieldset className="stack" style={{ gap: 14, border: 0, padding: 0, margin: 0 }} id="essentials">
          <legend className="label" style={{ marginBottom: 8 }}>{DETAIL_GROUP_TITLE.essentials}</legend>
          <TextField id={`${uid}-height`} label="Height (cm)" type="number" inputMode="numeric" min={DETAIL_LIMITS.heightMin} max={DETAIL_LIMITS.heightMax} value={value.heightCm ?? ''}
            onChange={(e) => set('heightCm', e.target.value === '' ? null : Number(e.target.value))} error={errors.heightCm} />
          {vis('height', 'Who can see your height')}
          <TextField id={`${uid}-job`} label="Job title" maxLength={DETAIL_LIMITS.jobTitle} value={value.jobTitle ?? ''} onChange={(e) => set('jobTitle', e.target.value || null)} error={errors.jobTitle} />
          <TextField id={`${uid}-co`} label="Company or school" maxLength={DETAIL_LIMITS.company} value={value.companyOrSchool ?? ''} onChange={(e) => set('companyOrSchool', e.target.value || null)} error={errors.companyOrSchool} />
          {vis('work', 'Who can see your work')}
          <Pick id={`${uid}-edu`} label="Education" list={EDUCATION} value={value.educationLevel} onChange={(v) => set('educationLevel', v)} error={errors.educationLevel} />
          {vis('education', 'Who can see your education')}
        </fieldset>
      )}
      {show('languages') && (
        <fieldset className="stack" style={{ gap: 14, border: 0, padding: 0, margin: 0 }} id="languages">
          <legend className="label" style={{ marginBottom: 8 }}>{DETAIL_GROUP_TITLE.languages} <span className="subtle">({value.languages.length}/{DETAIL_LIMITS.languagesMax})</span></legend>
          <div className="chips" role="group" aria-label="Languages you speak">
            {LANGUAGES.map((l) => (
              <button type="button" key={l.id} className="chip chip-toggle" aria-pressed={value.languages.includes(l.id)} disabled={!value.languages.includes(l.id) && value.languages.length >= DETAIL_LIMITS.languagesMax}
                onClick={() => set('languages', toggle(value.languages, l.id))}>{l.label}</button>
            ))}
          </div>
          {errors.languages && <p className="field-error" role="alert">{errors.languages}</p>}
          {vis('languages', 'Who can see your languages')}
        </fieldset>
      )}
      {show('lifestyle') && (
        <fieldset className="stack" style={{ gap: 14, border: 0, padding: 0, margin: 0 }} id="lifestyle">
          <legend className="label" style={{ marginBottom: 8 }}>{DETAIL_GROUP_TITLE.lifestyle}</legend>
          <Pick id={`${uid}-drink`} label="Drinking" list={DRINKING} value={value.drinking} onChange={(v) => set('drinking', v)} error={errors.drinking} />
          <Pick id={`${uid}-smoke`} label="Smoking" list={SMOKING} value={value.smoking} onChange={(v) => set('smoking', v)} error={errors.smoking} />
          <Pick id={`${uid}-ex`} label="Exercise" list={EXERCISE} value={value.exercise} onChange={(v) => set('exercise', v)} error={errors.exercise} />
          <Pick id={`${uid}-diet`} label="Diet" list={DIET} value={value.diet} onChange={(v) => set('diet', v)} error={errors.diet} />
          <div className="field"><span className="label" id={`${uid}-pets`}>Pets</span>
            <div className="chips" role="group" aria-labelledby={`${uid}-pets`}>{PETS.map((p) => <button type="button" key={p.id} className="chip chip-toggle" aria-pressed={value.pets.includes(p.id)} onClick={() => set('pets', toggle(value.pets, p.id))}>{p.label}</button>)}</div></div>
          {vis('lifestyle', 'Who can see your lifestyle')}
        </fieldset>
      )}
      {show('family') && (
        <fieldset className="stack" style={{ gap: 14, border: 0, padding: 0, margin: 0 }} id="family">
          <legend className="label" style={{ marginBottom: 8 }}>{DETAIL_GROUP_TITLE.family}</legend>
          <Pick id={`${uid}-has`} label="Do you have kids?" list={HAS_KIDS} value={value.hasKids} onChange={(v) => set('hasKids', v)} error={errors.hasKids} />
          <Pick id={`${uid}-want`} label="Do you want kids?" list={WANTS_KIDS} value={value.wantsKids} onChange={(v) => set('wantsKids', v)} error={errors.wantsKids} />
          {vis('kids', 'Who can see your answers about kids')}
          <Pick id={`${uid}-struct`} label="Relationship style" list={STRUCTURE} value={value.relationshipStructure} onChange={(v) => set('relationshipStructure', v)} error={errors.relationshipStructure} />
          {vis('structure', 'Who can see your relationship style')}
        </fieldset>
      )}
      {show('links') && (
        <fieldset className="stack" style={{ gap: 14, border: 0, padding: 0, margin: 0 }} id="links">
          <legend className="label" style={{ marginBottom: 8 }}>{DETAIL_GROUP_TITLE.links}</legend>
          <TextField id={`${uid}-ig`} label="Instagram handle" autoCapitalize="none" spellCheck={false} placeholder="yourname" value={value.instagramHandle ?? ''} onChange={(e) => set('instagramHandle', e.target.value.replace(/^@/, '') || null)} error={errors.instagramHandle}
            hint="Without the @. We don’t check that the account exists." />
          {vis('instagram', 'Who can see your Instagram', INSTAGRAM_AUDIENCES)}
        </fieldset>
      )}
      {show('sensitive') && (
        <fieldset className="stack card card-pad" style={{ gap: 14, margin: 0, boxShadow: 'none' }} id="sensitive">
          <legend className="label" style={{ padding: '0 6px' }}>{DETAIL_GROUP_TITLE.sensitive}</legend>
          <Notice><EyeOff size={14} aria-hidden style={{ verticalAlign: -2, marginRight: 6 }} />This is sensitive, so it’s off unless you choose to add it. It’s only for display: it’s never used to filter or rank people, never for ads, and you can hide or remove it at any time.</Notice>
          <label className="switch-row"><span className="grow"><b>Add my religion to my profile</b></span>
            <input type="checkbox" className="switch" checked={value.religion !== null} onChange={(e) => set('religion', e.target.checked ? 'other' : null)} aria-label="Add my religion to my profile" /></label>
          {value.religion !== null && <>
            <Pick id={`${uid}-rel`} label="Religion" list={RELIGION} value={value.religion} onChange={(v) => set('religion', v ?? 'other')} error={errors.religion} />
            {vis('religion', 'Who can see your religion')}
            <p className="subtle">Starts as “Only me”. Nobody sees it until you change that.</p></>}
        </fieldset>
      )}
    </div>
  );
}
