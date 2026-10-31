/* Phase 3.5 profile data model: username, optional details with per-field visibility, validation and completeness.
   Principle: collect only what a visible feature, filter or safety function uses. Everything here beyond the required basics is optional.
   Never collected or stored: caste, income or net worth, exact address, GPS history, government ID numbers or documents, health conditions,
   sexual history, immigration status, biometrics. The database has no column for any of them and rejects unknown fields. */

/** The version of the (draft) terms a person accepted. Bump it when the text changes; people are asked again. */
export const TERMS_VERSION = '2026-11-draft-1';

/* ---------------------------------------------------------------- visibility */

/** P public, F followers, M matches only, X private to me. */
export type Visibility = 'P' | 'F' | 'M' | 'X';
export const VISIBILITY_LABEL: Record<Visibility, string> = { P: 'Anyone who can see my profile', F: 'My followers', M: 'My matches only', X: 'Only me' };
export type VisibilityKey = 'instagram' | 'height' | 'work' | 'education' | 'languages' | 'lifestyle' | 'kids' | 'structure' | 'religion';
export const DEFAULT_VISIBILITY: Record<VisibilityKey, Visibility> = { instagram: 'M', height: 'P', work: 'M', education: 'P', languages: 'P', lifestyle: 'P', kids: 'P', structure: 'P', religion: 'X' };
export type VisibilityMap = Partial<Record<VisibilityKey, Visibility>>;
export const visibilityOf = (m: VisibilityMap, k: VisibilityKey): Visibility => m[k] ?? DEFAULT_VISIBILITY[k];

/* ----------------------------------------------------------------- catalogs */

export interface Option<T extends string = string> { id: T; label: string }
const opts = <T extends string>(...pairs: [T, string][]): Option<T>[] => pairs.map(([id, label]) => ({ id, label }));
export const EDUCATION = opts(['high-school', 'High school'], ['trade', 'Trade or vocational'], ['some-college', 'Some college'], ['bachelors', 'Bachelor’s degree'], ['masters', 'Master’s degree'], ['doctorate', 'Doctorate'], ['other', 'Other']);
export const DRINKING = opts(['never', 'Never'], ['rarely', 'Rarely'], ['socially', 'Socially'], ['often', 'Often']);
export const SMOKING = opts(['never', 'Never'], ['sometimes', 'Sometimes'], ['regularly', 'Regularly']);
export const EXERCISE = opts(['never', 'Never'], ['sometimes', 'Sometimes'], ['often', 'Often'], ['daily', 'Daily']);
export const DIET = opts(['vegetarian', 'Vegetarian'], ['eggetarian', 'Eggetarian'], ['vegan', 'Vegan'], ['non-vegetarian', 'Non-vegetarian'], ['pescatarian', 'Pescatarian'], ['other', 'Other']);
export const PETS = opts(['dog', 'Dog'], ['cat', 'Cat'], ['bird', 'Bird'], ['fish', 'Fish'], ['other', 'Other pets']);
export const HAS_KIDS = opts(['no', 'No kids'], ['yes', 'Has kids']);
export const WANTS_KIDS = opts(['no', 'Doesn’t want kids'], ['yes', 'Wants kids'], ['open', 'Open to kids']);
export const STRUCTURE = opts(['monogamy', 'Monogamy'], ['ethical-non-monogamy', 'Ethical non-monogamy'], ['open-to-discuss', 'Open to discuss']);
export const RELIGION = opts(['hindu', 'Hindu'], ['muslim', 'Muslim'], ['christian', 'Christian'], ['sikh', 'Sikh'], ['buddhist', 'Buddhist'], ['jain', 'Jain'], ['jewish', 'Jewish'], ['spiritual', 'Spiritual'], ['atheist', 'Atheist'], ['agnostic', 'Agnostic'], ['other', 'Other']);
/** Mirrors public.languages. ISO 639-1. */
export const LANGUAGES = opts(
  ['en', 'English'], ['hi', 'Hindi'], ['ta', 'Tamil'], ['ml', 'Malayalam'], ['te', 'Telugu'], ['kn', 'Kannada'], ['bn', 'Bengali'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['pa', 'Punjabi'],
  ['ur', 'Urdu'], ['or', 'Odia'], ['as', 'Assamese'], ['ne', 'Nepali'], ['si', 'Sinhala'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'],
  ['ru', 'Russian'], ['ar', 'Arabic'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['id', 'Indonesian'], ['ms', 'Malay'], ['th', 'Thai'], ['vi', 'Vietnamese'], ['tr', 'Turkish'],
  ['fa', 'Persian'], ['he', 'Hebrew'], ['pl', 'Polish'], ['nl', 'Dutch'], ['sv', 'Swedish'], ['no', 'Norwegian'], ['da', 'Danish'], ['fi', 'Finnish'], ['el', 'Greek'], ['cs', 'Czech'],
  ['ro', 'Romanian'], ['hu', 'Hungarian'], ['uk', 'Ukrainian'], ['sw', 'Swahili'], ['am', 'Amharic'], ['ha', 'Hausa'], ['yo', 'Yoruba'], ['zu', 'Zulu'], ['af', 'Afrikaans'], ['tl', 'Filipino']);
export const labelOf = (list: Option[], id: string | null | undefined) => list.find((o) => o.id === id)?.label ?? null;
export const languageNames = (codes: string[]) => codes.map((c) => labelOf(LANGUAGES, c) ?? c);

/* ------------------------------------------------------------------ details */

/** The optional details of one person, as the owner edits them. */
export interface ProfileDetails {
  instagramHandle: string | null; heightCm: number | null; jobTitle: string | null; companyOrSchool: string | null; educationLevel: string | null;
  languages: string[]; drinking: string | null; smoking: string | null; exercise: string | null; diet: string | null; pets: string[];
  hasKids: string | null; wantsKids: string | null; relationshipStructure: string | null; religion: string | null;
}
export const emptyDetails = (): ProfileDetails => ({
  instagramHandle: null, heightCm: null, jobTitle: null, companyOrSchool: null, educationLevel: null, languages: [], drinking: null, smoking: null, exercise: null, diet: null,
  pets: [], hasKids: null, wantsKids: null, relationshipStructure: null, religion: null,
});

/** What the database returns for someone else: only the fields you may see, snake_case, and only the ones that are set. */
export interface VisibleDetails {
  instagram_handle?: string; height_cm?: number; job_title?: string; company_or_school?: string; education_level?: string; languages?: string[]; drinking?: string; smoking?: string;
  exercise?: string; diet?: string; pets?: string[]; has_kids?: string; wants_kids?: string; relationship_structure?: string; religion?: string;
}

/** One line per visible detail, ready to show. */
export function describeDetails(d: VisibleDetails): { key: string; label: string; value: string }[] {
  const out: { key: string; label: string; value: string }[] = [];
  const add = (key: string, label: string, value: string | null | undefined) => { if (value) out.push({ key, label, value }); };
  add('height', 'Height', d.height_cm ? `${d.height_cm} cm` : null);
  add('work', 'Work', [d.job_title, d.company_or_school].filter(Boolean).join(' at ') || null);
  add('education', 'Education', labelOf(EDUCATION, d.education_level));
  add('languages', 'Languages', d.languages?.length ? languageNames(d.languages).join(', ') : null);
  add('drinking', 'Drinking', labelOf(DRINKING, d.drinking)); add('smoking', 'Smoking', labelOf(SMOKING, d.smoking));
  add('exercise', 'Exercise', labelOf(EXERCISE, d.exercise)); add('diet', 'Diet', labelOf(DIET, d.diet));
  add('pets', 'Pets', d.pets?.length ? d.pets.map((p) => labelOf(PETS, p) ?? p).join(', ') : null);
  add('kids', 'Kids', [labelOf(HAS_KIDS, d.has_kids), labelOf(WANTS_KIDS, d.wants_kids)].filter(Boolean).join(' · ') || null);
  add('structure', 'Relationship style', labelOf(STRUCTURE, d.relationship_structure));
  add('religion', 'Religion', labelOf(RELIGION, d.religion));
  add('instagram', 'Instagram', d.instagram_handle ? `@${d.instagram_handle}` : null);
  return out;
}

/** Your own details in the shape other people receive, so one component can render both. */
export function detailsToVisible(d: ProfileDetails): VisibleDetails {
  const v: VisibleDetails = {};
  if (d.instagramHandle) v.instagram_handle = d.instagramHandle; if (d.heightCm) v.height_cm = d.heightCm; if (d.jobTitle) v.job_title = d.jobTitle; if (d.companyOrSchool) v.company_or_school = d.companyOrSchool;
  if (d.educationLevel) v.education_level = d.educationLevel; if (d.languages.length) v.languages = d.languages; if (d.drinking) v.drinking = d.drinking; if (d.smoking) v.smoking = d.smoking;
  if (d.exercise) v.exercise = d.exercise; if (d.diet) v.diet = d.diet; if (d.pets.length) v.pets = d.pets; if (d.hasKids) v.has_kids = d.hasKids; if (d.wantsKids) v.wants_kids = d.wantsKids;
  if (d.relationshipStructure) v.relationship_structure = d.relationshipStructure; if (d.religion) v.religion = d.religion;
  return v;
}

export const DETAIL_LIMITS = { jobTitle: 60, company: 60, instagram: 30, heightMin: 120, heightMax: 230, languagesMax: 10, genderCustom: 30 } as const;

// eslint-disable-next-line no-control-regex -- rejecting control characters is the purpose of this check
const CONTROL = /[\u0000-\u001f\u007f]/;
export const normalizeInstagram = (s: string) => s.trim().replace(/^@/, '').toLowerCase();

export type DetailErrors = Record<string, string>;
export function validateDetails(d: ProfileDetails): DetailErrors {
  const e: DetailErrors = {};
  if (d.instagramHandle) { const h = normalizeInstagram(d.instagramHandle); if (!/^[a-z0-9._]{1,30}$/.test(h) || h.includes('..')) e.instagramHandle = 'Use letters, numbers, dots and underscores, up to 30 characters.'; }
  if (d.heightCm !== null && (!Number.isInteger(d.heightCm) || d.heightCm < DETAIL_LIMITS.heightMin || d.heightCm > DETAIL_LIMITS.heightMax)) e.heightCm = `Enter your height in whole centimetres, ${DETAIL_LIMITS.heightMin} to ${DETAIL_LIMITS.heightMax}.`;
  for (const [k, v, max] of [['jobTitle', d.jobTitle, DETAIL_LIMITS.jobTitle], ['companyOrSchool', d.companyOrSchool, DETAIL_LIMITS.company]] as const) {
    if (v && ([...v.trim()].length > max || CONTROL.test(v))) e[k] = `Keep this under ${max} characters, without special characters.`;
  }
  if (d.educationLevel && !EDUCATION.some((o) => o.id === d.educationLevel)) e.educationLevel = 'Choose from the list.';
  if (d.languages.length > DETAIL_LIMITS.languagesMax) e.languages = `Pick up to ${DETAIL_LIMITS.languagesMax} languages.`;
  else if (d.languages.some((c) => !LANGUAGES.some((l) => l.id === c))) e.languages = 'Choose languages from the list.';
  const inList = (list: Option[], v: string | null) => v === null || list.some((o) => o.id === v);
  if (!inList(DRINKING, d.drinking)) e.drinking = 'Choose from the list.'; if (!inList(SMOKING, d.smoking)) e.smoking = 'Choose from the list.';
  if (!inList(EXERCISE, d.exercise)) e.exercise = 'Choose from the list.'; if (!inList(DIET, d.diet)) e.diet = 'Choose from the list.';
  if (d.pets.some((p) => !PETS.some((o) => o.id === p))) e.pets = 'Choose from the list.';
  if (!inList(HAS_KIDS, d.hasKids)) e.hasKids = 'Choose from the list.'; if (!inList(WANTS_KIDS, d.wantsKids)) e.wantsKids = 'Choose from the list.';
  if (!inList(STRUCTURE, d.relationshipStructure)) e.relationshipStructure = 'Choose from the list.'; if (!inList(RELIGION, d.religion)) e.religion = 'Choose from the list.';
  return e;
}

/** The patch sent to save_profile_details. Religion is only ever sent with an explicit opt-in. */
export function detailsPatch(d: ProfileDetails, opts: { religionOptIn: boolean }): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    instagram_handle: d.instagramHandle ? normalizeInstagram(d.instagramHandle) : null, height_cm: d.heightCm, job_title: d.jobTitle?.trim() || null, company_or_school: d.companyOrSchool?.trim() || null,
    education_level: d.educationLevel, languages: d.languages, drinking: d.drinking, smoking: d.smoking, exercise: d.exercise, diet: d.diet, pets: d.pets,
    has_kids: d.hasKids, wants_kids: d.wantsKids, relationship_structure: d.relationshipStructure,
  };
  if (d.religion === null) patch.religion = null; else if (opts.religionOptIn) { patch.religion = d.religion; patch.religion_optin = true; }
  return patch;
}

/* ----------------------------------------------------------------- username */

export const RESERVED_HANDLES = ['admin', 'administrator', 'support', 'lovoki', 'help', 'root', 'system', 'moderator', 'mod', 'staff', 'official', 'security', 'abuse', 'postmaster', 'null', 'undefined',
  'api', 'www', 'terms', 'privacy', 'settings', 'me', 'feed', 'discover', 'connections', 'messages', 'notifications', 'login', 'logout', 'signup', 'register', 'about', 'contact', 'team', 'news',
  'blog', 'press', 'legal', 'safety', 'trust', 'billing', 'payments', 'noreply', 'no.reply', 'info', 'hello', 'home', 'app', 'u', 'p', 'onboarding', 'welcome'];
export const USERNAME_COOLDOWN_DAYS = 30;
export const normalizeHandle = (s: string) => s.trim().replace(/^@/, '').toLowerCase();
/** Quick local check so the form can answer instantly. The database repeats it and also checks availability. */
export function validateUsername(raw: string): string | null {
  const h = normalizeHandle(raw);
  if (!h) return 'Choose a username.';
  if (h.length < 3) return 'Use at least 3 characters.';
  if (h.length > 30) return 'Use 30 characters or fewer.';
  if (!/^[a-z0-9._]+$/.test(h)) return 'Use lowercase letters, numbers, dots and underscores only.';
  if (h.startsWith('.') || h.endsWith('.') || h.includes('..')) return 'Dots can’t start or end a username, or appear twice in a row.';
  if (RESERVED_HANDLES.includes(h)) return 'That name is reserved. Choose another.';
  return null;
}
export type HandleStatus = 'available' | 'unavailable' | 'invalid' | 'reserved';
export const handleStatusText: Record<HandleStatus, string> = {
  available: 'Available.', unavailable: 'That username isn’t available.', invalid: 'Use 3 to 30 lowercase letters, numbers, dots or underscores.', reserved: 'That name is reserved. Choose another.',
};
/** A profile address: "/@handle". Returns the handle or null. */
export const handleFromPath = (segment: string): string | null => (segment.startsWith('@') && validateUsername(segment.slice(1)) === null ? segment.slice(1).toLowerCase() : null);

/* ------------------------------------------------------------------ password */

export const GENDER_CUSTOM_MAX = DETAIL_LIMITS.genderCustom;
