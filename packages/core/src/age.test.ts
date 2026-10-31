import { describe, it, expect } from 'vitest';
import { ageOn, dobError, isAdultOn, parseIsoDate, todayLocalIso } from './age';

// These boundary cases are repeated in supabase/tests/10_rls.sql against public.is_adult_on, so the browser and the database agree.
const SHARED: [dob: string, ref: string, adult: boolean][] = [
  ['2008-02-29', '2026-02-28', false], ['2008-02-29', '2026-03-01', true],
  ['2008-03-01', '2026-02-28', false], ['2008-03-01', '2026-03-01', true],
  ['2008-02-28', '2026-02-28', true],
  ['2006-02-28', '2024-02-29', true], ['2006-03-01', '2024-02-29', false],
];

describe('adult eligibility (18+)', () => {
  it.each(SHARED)('dob %s on %s -> adult=%s', (dob, ref, adult) => expect(isAdultOn(dob, ref)).toBe(adult));
  it('turns 18 exactly on the birthday, not the day before', () => {
    expect(isAdultOn('2000-07-15', '2018-07-14')).toBe(false);
    expect(isAdultOn('2000-07-15', '2018-07-15')).toBe(true);
    expect(isAdultOn('2000-07-15', '2018-07-16')).toBe(true);
  });
  it('computes whole-year ages around a birthday', () => {
    expect(ageOn('1990-06-15', '2026-06-14')).toBe(35);
    expect(ageOn('1990-06-15', '2026-06-15')).toBe(36);
    expect(ageOn('1990-12-31', '2026-01-01')).toBe(35);
  });
  it('treats a leap-day birthday as turning a year older on Mar 1 in common years', () => {
    expect(ageOn('2004-02-29', '2025-02-28')).toBe(20);
    expect(ageOn('2004-02-29', '2025-03-01')).toBe(21);
    expect(ageOn('2004-02-29', '2028-02-29')).toBe(24);
  });
  it('rejects future dates and invalid calendar dates', () => {
    expect(ageOn('2030-01-01', '2026-01-01')).toBeNull();
    for (const bad of ['2025-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '26-01-01', '', 'not a date', '2026-1-1', '2026-01-01T00:00']) expect(parseIsoDate(bad)).toBeNull();
    expect(parseIsoDate('2024-02-29')).toEqual({ y: 2024, m: 2, d: 29 });
  });
  it('gives precise, kind messages', () => {
    const ref = '2026-10-31';
    expect(dobError('', ref)).toMatch(/Enter your date of birth/);
    expect(dobError('2026-02-30', ref)).toMatch(/real date/);
    expect(dobError('2027-01-01', ref)).toMatch(/future/);
    expect(dobError('2010-01-01', ref)).toBe('LOVOKI is for adults 18 and over.');
    expect(dobError('1850-01-01', ref)).toMatch(/year of birth/);
    expect(dobError('2008-10-31', ref)).toBeNull();
    expect(dobError('2008-11-01', ref)).toBe('LOVOKI is for adults 18 and over.');
  });
  it('formats the local calendar date without timezone shifts', () => {
    expect(todayLocalIso(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(todayLocalIso(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});
