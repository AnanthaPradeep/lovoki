"""Manual mutation checks for Phase 4 (LOCAL database only). Loosens one database rule at a time, runs the dating integration
tests, and reports whether they failed (they must). Each rule is restored from the migration text afterwards.

Run:  python scripts/mutation-check.py            (needs the local stack; takes a few minutes)
It never touches anything but the container named supabase_db_lovoki."""
import os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MIG = open(os.path.join(ROOT, 'supabase', 'migrations', '20261103000000_phase4_dating.sql'), encoding='utf-8').read()

def psql(sql):
    r = subprocess.run(['docker', 'exec', '-i', 'supabase_db_lovoki', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], input=sql, capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0: raise SystemExit('psql failed: ' + r.stderr[:400])

def func(name):
    m = re.search(r'create (?:or replace )?function public\.' + name + r'.*?as \$\$.*?\$\$;', MIG, re.S)
    assert m, name
    s = m.group(0)
    return s if s.startswith('create or replace') else s.replace('create function', 'create or replace function', 1)

# Equivalent mutants cannot be killed by any test. The adult re-check inside _dating_eligible is defence in depth: the age-range
# check constraint (18 to 99) already rejects every minor, so removing the re-check changes no observable behaviour.
EQUIVALENT = {'under-18 re-check removed'}

MUTATIONS = [
    ('gender compatibility ignored', '_gender_wanted', lambda s: re.sub(r'as \$\$.*\$\$;', 'as $$ select true $$;', s, flags=re.S)),
    ('exclusions (unmatch/block) ignored', '_dating_eligible', lambda s: re.sub(r"  if exists \(select 1 from public\.dating_exclusions.*?\n", '', s, count=1)),
    ('pause ignored', '_dating_eligible', lambda s: s.replace("if not coalesce(tdis, false) and not p_ignore_pause then return false; end if;", '')),
    ('age ranges ignored', '_dating_eligible', lambda s: s.replace("if not (ta between vmin and vmax and va between tmin and tmax) then return false; end if;", '')),
    ('under-18 re-check removed', '_dating_eligible', lambda s: s.replace(" or not public.is_adult_on(vdob, current_date) or not public.is_adult_on(tdob, current_date)", '')),
    ('distance limit ignored', '_dating_eligible', lambda s: s.replace("if dist is not null and dist >= lim then return false; end if;", '')),
    ('pair lock removed (race)', 'like_profile', lambda s: re.sub(r"  perform pg_advisory_xact_lock\(hashtextextended\('lovoki:pair:' \|\| least\(u, p_target\).*?\n", '', s, count=1)),
]

failed_to_catch = []
for label, fn, mut in MUTATIONS:
    original = func(fn); mutated = mut(original)
    assert mutated != original, f'mutation did not change {fn}: {label}'
    psql(mutated)
    try:
        r = subprocess.run(['npx.cmd' if os.name == 'nt' else 'npx', 'vitest', 'run', '-c', 'vitest.integration.config.ts', 'tests/integration/dating.int.test.ts'],
                           cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', shell=(os.name == 'nt'))
        out = re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr)
        m = re.search(r'Tests\s+(\d+) failed', out)
        n = int(m.group(1)) if m else 0
        print(f'{"CAUGHT" if n else "MISSED"}  {label}: {n} failing test(s)', flush=True)
        if not n and label not in EQUIVALENT: failed_to_catch.append(label)
        if not n and label in EQUIVALENT: print('        (equivalent mutant: redundant by the age-range constraint, see comment)')
    finally:
        psql(original)
print('restored; MISSED mutations:', failed_to_catch or 'none')
sys.exit(1 if failed_to_catch else 0)
