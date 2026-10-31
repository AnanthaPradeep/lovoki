/**
 * Calendar-date age math with no timezone or Date-object drift: dates are 'YYYY-MM-DD' strings
 * and are compared as (year, month, day). The database applies the same rule
 * (public.is_adult_on); packages/core/src/age.test.ts and supabase/tests/rls.sql share boundary cases.
 */
export interface Ymd { y: number; m: number; d: number }

export const MIN_ADULT_AGE = 18;
export const MAX_PLAUSIBLE_AGE = 120;

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function parseIsoDate(s: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return null;
  const dim = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
  return d > dim ? null : { y, m: mo, d };
}

const cmp = (a: Ymd, b: Ymd) => a.y - b.y || a.m - b.m || a.d - b.d;

/** Whole years between dob and ref. null when either date is invalid or dob is after ref. */
export function ageOn(dob: string, ref: string): number | null {
  const a = parseIsoDate(dob), b = parseIsoDate(ref);
  if (!a || !b || cmp(a, b) > 0) return null;
  return b.y - a.y - (b.m < a.m || (b.m === a.m && b.d < a.d) ? 1 : 0);
}

/** A person born on Feb 29 turns 18 on Mar 1 in non-leap years (same as Postgres interval arithmetic). */
export const isAdultOn = (dob: string, ref: string, min = MIN_ADULT_AGE): boolean => {
  const age = ageOn(dob, ref);
  return age !== null && age >= min;
};

/** The viewer's local calendar date. The server uses UTC and is authoritative at the boundary. */
export function todayLocalIso(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(now.getFullYear(), 4)}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function dobError(dob: string, ref: string): string | null {
  if (!dob.trim()) return 'Enter your date of birth.';
  if (!parseIsoDate(dob)) return 'Enter a real date, for example 1995-04-18.';
  const age = ageOn(dob, ref);
  if (age === null) return 'Date of birth can’t be in the future.';
  if (age < MIN_ADULT_AGE) return 'LOVOKI is for adults 18 and over.';
  if (age > MAX_PLAUSIBLE_AGE) return 'Check the year of birth.';
  return null;
}
