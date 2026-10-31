// STATIC checks on the SQL text. These are NOT database tests: the database behaviour is tested by
// scripts/db-test.sh (local Postgres) and, for a real project, by docs/PHASE_2_SETUP.md section 9.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_INTERESTS, interestSlug } from './index';

const dir = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(dir + f, 'utf8')).join('\n');
const noComments = sql.replace(/--.*$/gm, '');

describe('migration text', () => {
  const tables = [...noComments.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]!);
  it('finds the expected tables', () => expect(tables.sort()).toEqual([
    'blocks', 'content_reports', 'dating_actions', 'dating_exclusions', 'dating_preferences', 'dating_rate', 'follows', 'interests', 'matches', 'notifications', 'onboarding_state', 'post_comments', 'post_likes',
    'post_media', 'post_saves', 'posts', 'profile_interests', 'profile_photos', 'profile_places', 'profile_prompts', 'profiles', 'profiles_private']));
  it('enables row level security on every client-accessible table', () => {
    const looped = [...noComments.matchAll(/foreach t in array array\[([^\]]+)\]/g)].flatMap((m) => m[1]!.match(/'(\w+)'/g)!.map((s) => s.replace(/'/g, '')));
    for (const t of tables) expect(looped.includes(t) || new RegExp(`alter table public\\.${t} enable row level security`).test(noComments), t).toBe(true);
    expect(noComments).toMatch(/enable row level security/);
  });
  it('gives clients no write privileges on tables', () => {
    expect(noComments).not.toMatch(/grant\s+(insert|update|delete|all)[^;]*on\s+(table\s+)?public\./i);
    expect(noComments).not.toMatch(/\bgrant\b[^;]*\bto\b[^;]*\banon\b/i);
  });
  it('every SECURITY DEFINER function pins search_path', () => {
    const defs = noComments.split(/create (?:or replace )?function/i).slice(1).filter((b) => /security definer/i.test(b.split(/\$\$/)[0]!));
    expect(defs.length).toBeGreaterThan(5);
    for (const d of defs) expect(d.split(/\$\$/)[0], d.slice(0, 60)).toMatch(/set search_path\s*=\s*''/i);
  });
  it('never embeds a secret or key (granting a function to service_role for operators is allowed)', () => {
    expect(noComments).not.toMatch(/sb_secret|eyJ[A-Za-z0-9_-]{10,}|service_role_key/i);
    for (const m of noComments.matchAll(/service_role/gi)) expect(noComments.slice(Math.max(0, m.index! - 40), m.index!), 'service_role only appears in a GRANT').toMatch(/to\s+$/i);
  });
  it('Phase 3: clients get no SELECT on posts, post_media, post_likes or post_comments (read only through the page functions)', () => {
    const grants = [...noComments.matchAll(/grant select on ([^;]+?) to authenticated/gi)].map((m) => m[1]).join(',');
    for (const t of ['posts', 'post_media', 'post_likes', 'post_comments']) expect(grants, t).not.toContain(`public.${t}`);
  });
  it('Phase 3: social code never reads dating state', () => {
    const social = readFileSync(dir + '20261102000000_phase3_social.sql', 'utf8').replace(/--.*$/gm, '');
    const withoutPhotoRule = social.replace(/create or replace function public\.can_view_photos_of[\s\S]*?end \$\$;/, '');
    expect(withoutPhotoRule).not.toMatch(/dating_preferences|dating_discoverable|match/i);
  });
  it('Phase 4: dating tables have no client privileges beyond own-place read, and nothing is granted to anon', () => {
    const p4 = readFileSync(dir + '20261103000000_phase4_dating.sql', 'utf8').replace(/--.*$/gm, '');
    expect(p4).not.toMatch(/grant\s+(insert|update|delete|all)/i);
    expect([...p4.matchAll(/grant select on ([^;]+?) to authenticated/gi)].map((m) => m[1])).toEqual(['public.profile_places']);
    expect(p4).not.toMatch(/\bto\s+anon\b/i);
  });
  it('Phase 4: the named limits live in exactly one function each', () => {
    const p4 = readFileSync(dir + '20261103000000_phase4_dating.sql', 'utf8');
    for (const f of ["_limit_daily_likes", "_limit_discover_hourly", "_pass_days"]) expect(p4.split(`create function public.${f}(`).length - 1, f).toBe(1);
  });
  it('the public views use date_of_birth only as the input to age_of(), never as an output column', () => {
    for (const v of ['public_profiles']) {
      const body = new RegExp(`create view public\\.${v}[\\s\\S]*?;`).exec(noComments)![0];
      expect(body).toMatch(/public\.age_of\(pr\.date_of_birth\) as age/);
      expect(body.replace(/public\.age_of\(pr\.date_of_birth\)/g, '')).not.toMatch(/\bdate_of_birth\b/);
    }
  });
  it('the interests catalog matches the application list exactly', () => {
    const inserted = [...noComments.matchAll(/\('([a-z0-9-]+)', '([^']+)'\)/g)].map((m) => [m[1], m[2]]).filter(([s]) => ALL_INTERESTS.map(interestSlug).includes(s!));
    expect(inserted.map(([, l]) => l).sort()).toEqual([...ALL_INTERESTS].sort());
    for (const [s, l] of inserted) expect(s).toBe(interestSlug(l!));
  });
  it('photo storage is private, size and type limited, with owner-scoped policies and no update policy', () => {
    expect(noComments).toMatch(/'profile-photos', 'profile-photos', false, 5242880/);
    expect(noComments).toMatch(/array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
    expect(noComments).toMatch(/on storage\.objects for insert/);
    expect(noComments).toMatch(/on storage\.objects for delete/);
    expect(noComments).not.toMatch(/on storage\.objects for update/);
  });
});
