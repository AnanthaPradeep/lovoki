"""Manual mutation checks for Phase 4.5 (LOCAL database only). Loosens ONE privacy rule at a time, runs the privacy integration
tests, and reports whether they failed (they must). Each rule is restored from the migration text afterwards, even if a run crashes.

Run:  python scripts/mutation-check-45.py            (needs the local stack; takes several minutes)
It never touches anything but the container named supabase_db_lovoki."""
import os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MIG = open(os.path.join(ROOT, 'supabase', 'migrations', '20261105000000_phase45_profiles_privacy.sql'), encoding='utf-8').read()

def psql(sql):
    r = subprocess.run(['docker', 'exec', '-i', 'supabase_db_lovoki', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], input=sql, capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0: raise SystemExit('psql failed: ' + r.stderr[:500])

def func(name):
    m = re.search(r'create (?:or replace )?function public\.' + name + r'\(.*?as \$\$.*?\$\$;', MIG, re.S)
    assert m, name
    s = m.group(0)
    return s if s.startswith('create or replace') else s.replace('create function', 'create or replace function', 1)

def rep(old, new, count=1):
    def f(s):
        assert old in s, f'mutation target not found: {old[:70]}'
        return s.replace(old, new, count)
    return f

FUNCTION_MUTATIONS = [
    ('avatar context shown to everyone', 'can_view_content', rep("if p_audience = 'avatar' and everyone then return true; end if;", "if p_audience = 'avatar' then return true; end if;")),
    ('follower/following lists ignore "hide counts"', 'can_view_content', rep("if p_audience = 'people' and not counts then return false; end if;", '')),
    ('private account treated as public for content', 'can_view_content', rep("effective := case when p_audience = 'followers' or vis = 'followers' then 'followers' else 'public' end;", "effective := 'public';")),
    ('blocked pairs may see the card and avatar', 'can_view_content', rep("if public._blocked_between(p_viewer, p_author) then return false; end if;\n  if not (public._is_completed", "if false then return false; end if;\n  if not (public._is_completed")),
    ('thumbnails and originals readable by anyone signed in', 'can_read_post_media', rep('return public.can_view_content(u, a, aud);', 'return true;')),
    ('thumbnails not covered by the post audience', 'can_read_post_media', rep(' or pm.thumb_path = p_name', '')),
    ('profile picture of an opted-in account exposes every photo', 'can_read_profile_photo', rep("return public.can_view_content(u, o, 'avatar') and public._avatar_path(o) = p_name;", "return public.can_view_content(u, o, 'avatar');")),
    ('stranger sees the real avatar of a private account', '_social_profile', rep('public._social_avatar_path(v, t), case when', 'public._avatar_path(t), case when')),
    ('stranger sees area, age, details of a private account', '_social_profile', rep('case when full_view then pr.area_label end', 'pr.area_label')),
    ('hidden counts still shown', '_social_profile', rep("select (pr.show_follower_counts or pr.user_id = v) into show_counts", "select true into show_counts")),
    ('lists are not gated', '_profile_people', rep("if not public.can_view_content(v, t, 'people') then return; end if;", '')),
    ('grid and feeds skip the visibility check', '_post_rows', rep('and public.can_view_content(p_viewer, po.author_id, po.audience)\n', 'and true\n')),
    ('search ignores "not searchable"', 'search_profiles', rep('pr.searchable_by_username and ', '')),
    ('search returns blocked people', 'search_profiles', rep("and public.can_view_content(u, pr.user_id, 'card')", '')),
    ('search is not rate limited', 'search_profiles', rep("perform public._rate_hit('search', 40, 'minute');", '')),
    ('sample accounts receive notifications', '_notify', rep('if public._is_sample(p_recipient) then return; end if;', '')),
    ('a like on a sample is stored (and can match)', 'like_profile', rep('if public._is_sample(p_target) then return query select false, null::uuid; return; end if;', '')),
    ('samples can be reported', 'report_content', rep("if public._is_sample(a) then raise exception 'LOVOKI_SAMPLE_TARGET'; end if;", '')),
    ('sample rows allowed in production', '_guard_sample', rep("if new.is_sample and not public._is_development() then", "if false then")),
    ('app_config editable at runtime', '_guard_app_config', rep("if current_setting('lovoki.allow_config_change', true) is distinct from 'on' then", "if false then")),
    ('create_post accepts a thumbnail that is not the caller\'s', 'create_post', rep("p_thumb_path !~ ('^' || u::text || '/' || p_post_id::text || shape)", 'false')),
]

# Not a function body: put back the Phase 3 behaviour (going public accepts every pending request) and expect the transition test to notice.
AUTO_ACCEPT_UP = """
create function public._mut_accept() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.social_visibility = 'public' and old.social_visibility = 'followers' then
    update public.follows set status = 'accepted', accepted_at = now() where followee_id = new.user_id and status = 'pending';
  end if;
  return new;
end $$;
create trigger _mut_accept after update of social_visibility on public.profiles for each row execute function public._mut_accept();
"""
AUTO_ACCEPT_DOWN = "drop trigger if exists _mut_accept on public.profiles; drop function if exists public._mut_accept();"

def run_tests():
    r = subprocess.run(['npx.cmd' if os.name == 'nt' else 'npx', 'vitest', 'run', '-c', 'vitest.integration.config.ts', 'tests/integration/privacy45.int.test.ts'],
                       cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', shell=(os.name == 'nt'))
    out = re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr)
    m = re.search(r'Tests\s+(\d+) failed', out)
    return int(m.group(1)) if m else 0

missed = []
def report(label, n):
    print(f'{"CAUGHT" if n else "MISSED"}  {label}: {n} failing test(s)', flush=True)
    if not n: missed.append(label)

for label, fn, mut in FUNCTION_MUTATIONS:
    original = func(fn); mutated = mut(original)
    assert mutated != original, f'mutation did not change {fn}: {label}'
    psql(mutated)
    try: report(label, run_tests())
    finally: psql(original)

psql(AUTO_ACCEPT_UP)
try: report('going public silently approves pending requests (Phase 3 behaviour)', run_tests())
finally: psql(AUTO_ACCEPT_DOWN)
print('restored; MISSED mutations:', missed or 'none')
sys.exit(1 if missed else 0)
