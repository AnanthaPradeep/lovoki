\set ON_ERROR_STOP on
-- Database tests: constraints, RLS, privileges and function logic on a real Postgres engine.
-- A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

create schema t;
grant usage on schema t to public;
create function t.pass(name text) returns void language plpgsql as $$ begin raise notice 'PASS: %', name; end $$;
create function t.expect_error(q text, pat text) returns void language plpgsql as $$
declare raised boolean := false; m text;
begin
  begin execute q; exception when others then raised := true; m := sqlerrm; end;
  if not raised then raise exception 'expected an error matching "%" but it succeeded: %', pat, q; end if;
  if m not ilike '%' || pat || '%' then raise exception 'expected "%" but got "%" for: %', pat, m, q; end if;
end $$;
create function t.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u::text, false); perform set_config('role', 'authenticated', false); end $$;
create function t.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', false); perform set_config('role', 'anon', false); end $$;
create function t.as_admin() returns void language plpgsql as $$
begin perform set_config('role', 'none', false); perform set_config('request.jwt.claim.sub', '', false); end $$;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@example.test');

/* ---- account creation ---- */
do $$ begin
  assert (select count(*) from public.profiles) = 3, 'trigger creates a profile per user';
  assert (select count(*) from public.profiles_private) = 3 and (select count(*) from public.dating_preferences) = 3
     and (select count(*) from public.onboarding_state) = 3, 'trigger creates all account rows';
  perform t.pass('signup trigger creates every account row');
end $$;

select t.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$ begin
  perform public.ensure_account(); perform public.ensure_account();
  perform t.as_admin();
  assert (select count(*) from public.profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1, 'ensure_account is idempotent';
  perform t.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  perform t.pass('ensure_account is idempotent (no duplicates)');
end $$;

/* ---- isolation: A sees only A ---- */
do $$ begin
  assert (select count(*) from public.profiles) = 1, 'A sees one profile';
  assert (select count(*) from public.profiles_private) = 1, 'A sees one private row';
  assert (select count(*) from public.dating_preferences) = 1 and (select count(*) from public.onboarding_state) = 1, 'A sees own prefs/onboarding only';
  assert (select count(*) from public.profiles_private where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 0, 'A cannot read B date of birth row';
  assert (select count(*) from public.profiles where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 0, 'A cannot read B profile';
  perform t.pass('A cannot read B private or profile rows');
end $$;

/* ---- direct writes are impossible; ownership cannot be changed ---- */
do $$ begin
  perform t.expect_error($q$update public.profiles set display_name = 'x'$q$, 'permission denied');
  perform t.expect_error($q$update public.profiles set user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$q$, 'permission denied');
  perform t.expect_error($q$insert into public.profiles (user_id) values (gen_random_uuid())$q$, 'permission denied');
  perform t.expect_error($q$delete from public.profiles$q$, 'permission denied');
  perform t.expect_error($q$update public.profiles_private set date_of_birth = '1990-01-01'$q$, 'permission denied');
  perform t.expect_error($q$update public.onboarding_state set completed_at = now()$q$, 'permission denied');
  perform t.expect_error($q$insert into public.profile_photos (user_id, storage_path, position, content_type, size_bytes) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-000000000001.jpg',0,'image/jpeg',10)$q$, 'permission denied');
  perform t.expect_error($q$update public.dating_preferences set age_min = 18$q$, 'permission denied');
  perform t.pass('direct insert/update/delete denied on every table; user_id cannot be reassigned; completed_at cannot be forged');
end $$;

/* ---- adult eligibility enforced server-side ---- */
select t.as_admin();
do $$ begin
  assert public.is_adult_on('2008-02-29', '2026-02-28') = false, 'Feb 29 born: not adult on Feb 28';
  assert public.is_adult_on('2008-02-29', '2026-03-01') = true,  'Feb 29 born: adult on Mar 1';
  assert public.is_adult_on('2008-03-01', '2026-02-28') = false, 'Mar 1 born: not adult on Feb 28';
  assert public.is_adult_on('2008-03-01', '2026-03-01') = true,  'Mar 1 born: adult on 18th birthday';
  assert public.is_adult_on('2008-02-28', '2026-02-28') = true,  '18th birthday exactly';
  assert public.is_adult_on('2008-03-01', '2026-02-28') = false, 'day before 18th birthday';
  assert public.is_adult_on('2006-02-28', '2024-02-29') = true,  'leap ref day, born Feb 28';
  assert public.is_adult_on('2006-03-01', '2024-02-29') = false, 'leap ref day, born Mar 1';
  assert public.is_adult_on(null, '2026-01-01') = false, 'null dob is not adult';
  perform t.pass('is_adult_on boundary cases (birthdays, Feb 29) match the client rule');
end $$;

select t.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$ begin
  perform t.expect_error($q$select public.save_basics('Kid', ((current_date - interval '18 years')::date + 1), '')$q$, 'LOVOKI_UNDER_18');
  perform t.expect_error($q$select public.save_basics('Kid', current_date + 30, '')$q$, 'LOVOKI_UNDER_18');
  perform t.expect_error($q$select public.save_basics('Old', (current_date - interval '130 years')::date, '')$q$, 'LOVOKI_DOB_IMPLAUSIBLE');
  perform t.expect_error($q$select public.save_basics('', (current_date - interval '30 years')::date, '')$q$, 'LOVOKI_INVALID');
  perform t.expect_error($q$select public.save_basics('Alice', null, '')$q$, 'LOVOKI_INVALID');
  perform public.save_basics('Alice', (current_date - interval '18 years')::date, 'she/her');   -- exactly 18 today: allowed
  perform public.save_basics('Alice', (current_date - interval '30 years')::date, 'she/her');   -- onboarding not complete: may correct
  assert (select date_of_birth from public.profiles_private) = (current_date - interval '30 years')::date, 'dob stored';
  perform t.pass('under-18 and implausible dates rejected by the database; exactly 18 accepted');
end $$;

/* ---- other save functions: valid + invalid ---- */
do $$ begin
  perform public.save_about('Hello there', array['cooking','music'], '[{"question":"A perfect Sunday","answer":"Slow coffee"},{"question":"I geek out on","answer":"Maps"}]'::jsonb);
  assert (select count(*) from public.profile_interests) = 2 and (select count(*) from public.profile_prompts) = 2, 'about saved';
  perform public.save_about('Hello again', array['cooking'], '[]'::jsonb);
  assert (select count(*) from public.profile_interests) = 1 and (select count(*) from public.profile_prompts) = 0, 'about replaced, not appended';
  perform t.expect_error($q$select public.save_about(repeat('x', 301), '{}', '[]')$q$, 'LOVOKI_INVALID');
  perform t.expect_error($q$select public.save_about('', array['not-a-real-interest'], '[]')$q$, 'unknown interest');
  perform t.expect_error($q$select public.save_about('', array['cooking','music','swimming','running','coding','hiking','climbing','film','vinyl'], '[]')$q$, 'too many interests');
  perform t.expect_error($q$select public.save_about('', '{}', '[{"question":"A","answer":"1"},{"question":"A","answer":"2"}]'::jsonb)$q$, 'duplicate key');
  perform t.expect_error($q$select public.save_about('', '{}', '[{"question":"A","answer":""}]'::jsonb)$q$, 'check constraint');
  perform t.expect_error($q$select public.save_preferences(null, array['women'], 18, 40, null)$q$, 'LOVOKI_INVALID');
  perform t.expect_error($q$select public.save_preferences('long-term', '{}', 18, 40, null)$q$, 'LOVOKI_INVALID');
  perform t.expect_error($q$select public.save_preferences('long-term', array['women'], 17, 40, null)$q$, 'check constraint');
  perform t.expect_error($q$select public.save_preferences('long-term', array['women'], 40, 30, null)$q$, 'check constraint');
  perform t.expect_error($q$select public.save_preferences('whatever', array['women'], 18, 40, null)$q$, 'check constraint');
  perform t.expect_error($q$select public.save_privacy('9.931233, 76.267304', 'public', true)$q$, 'LOVOKI_INVALID');
  perform t.expect_error($q$select public.save_privacy('Kochi', 'everyone', true)$q$, 'check constraint');
  perform public.save_preferences('long-term', array['women','men'], 25, 40, 50);
  perform public.save_privacy('Kochi, Kerala', 'public', true);
  perform public.set_onboarding_step('photos');
  assert (select current_step from public.onboarding_state) = 'photos', 'step saved';
  perform t.pass('about/preferences/privacy/step saves validate and replace correctly');
end $$;

/* ---- completion is validated server-side ---- */
do $$ begin
  perform t.expect_error($q$select public.complete_onboarding()$q$, 'LOVOKI_ONBOARDING_INCOMPLETE:photos');
  assert (select completed_at from public.onboarding_state) is null, 'not completed';
  perform t.pass('complete_onboarding refuses while a required field is missing');
end $$;

/* ---- photo storage policies ---- */
do $$ begin
  insert into storage.objects (bucket_id, name, metadata) values
    ('profile-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-000000000001.jpg', '{"mimetype":"image/jpeg","size":2048}');
  perform t.expect_error($q$insert into storage.objects (bucket_id, name, metadata) values ('profile-photos', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/10000000-0000-4000-8000-000000000009.jpg', '{}')$q$, 'row-level security');
  perform t.expect_error($q$insert into storage.objects (bucket_id, name, metadata) values ('profile-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/evil.php', '{}')$q$, 'row-level security');
  perform t.expect_error($q$insert into storage.objects (bucket_id, name, metadata) values ('profile-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/sub/10000000-0000-4000-8000-000000000009.jpg', '{}')$q$, 'row-level security');
  perform t.expect_error($q$insert into storage.objects (bucket_id, name, metadata) values ('profile-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-000000000009.exe', '{}')$q$, 'row-level security');
  perform t.expect_error($q$insert into storage.objects (bucket_id, name, metadata) values ('other-bucket', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-000000000009.jpg', '{}')$q$, 'row-level security');
  perform t.pass('storage: only own folder, UUID name, fixed image extensions');
end $$;

do $$ declare n int; begin
  update storage.objects set name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000aa.jpg';
  get diagnostics n = row_count;
  assert n = 0, 'no UPDATE policy: objects cannot be overwritten or renamed';
  perform t.pass('storage: no overwrite or rename');
end $$;

/* ---- register / reorder / delete photos ---- */
do $$ declare id1 uuid; id2 uuid; gone text; begin
  perform t.expect_error($q$select public.register_photo('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/10000000-0000-4000-8000-000000000001.jpg')$q$, 'LOVOKI_INVALID: photo_path');
  perform t.expect_error($q$select public.register_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-00000000ffff.jpg')$q$, 'LOVOKI_PHOTO_MISSING');
  perform t.expect_error($q$select public.register_photo('../../etc/passwd')$q$, 'LOVOKI_INVALID: photo_path');
  id1 := public.register_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-000000000001.jpg');
  perform t.expect_error($q$select public.register_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-000000000001.jpg')$q$, 'duplicate key');
  insert into storage.objects (bucket_id, name, metadata) values
    ('profile-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-000000000002.jpg', '{"mimetype":"image/jpeg","size":4096}');
  id2 := public.register_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-000000000002.jpg');
  assert (select position from public.profile_photos where id = id2) = 1, 'second photo at position 1';
  perform public.reorder_photos(array[id2, id1]);
  assert (select position from public.profile_photos where id = id2) = 0 and (select position from public.profile_photos where id = id1) = 1, 'reordered';
  perform t.expect_error(format($q$select public.reorder_photos(array[%L::uuid])$q$, id1), 'LOVOKI_INVALID: photo_ids');
  perform t.expect_error(format($q$select public.reorder_photos(array[%L::uuid, %L::uuid, %L::uuid])$q$, id1, id1, id2), 'LOVOKI_INVALID: photo_ids');
  gone := public.delete_photo(id2);
  assert gone like '%/10000000-0000-4000-8000-000000000002.jpg', 'delete returns the path to remove from storage';
  assert (select position from public.profile_photos where id = id1) = 0, 'positions compacted';
  perform t.expect_error(format($q$select public.delete_photo(%L::uuid)$q$, id2), 'LOVOKI_NOT_FOUND');
  perform t.pass('register/reorder/delete photos: ownership, existence, permutation and compaction');
end $$;

/* ---- photo count limit ---- */
do $$ declare i int; nm text; begin
  for i in 3..8 loop
    nm := format('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-%s.jpg', lpad(i::text, 12, '0'));
    insert into storage.objects (bucket_id, name, metadata) values ('profile-photos', nm, '{"mimetype":"image/png","size":999}');
    if i < 8 then perform public.register_photo(nm); end if;
  end loop;
  assert (select count(*) from public.profile_photos) = 6, 'six photos registered';
  perform t.expect_error($q$select public.register_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-000000000007.jpg')$q$, 'LOVOKI_PHOTO_LIMIT');
  perform t.pass('seventh photo refused by the database');
end $$;

/* ---- per-user object cap (orphan abuse limit) ---- */
select t.as_user('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
do $$ declare i int; begin
  for i in 1..12 loop
    insert into storage.objects (bucket_id, name, metadata)
      values ('profile-photos', format('cccccccc-cccc-4ccc-8ccc-cccccccccccc/20000000-0000-4000-8000-%s.jpg', lpad(i::text, 12, '0')), '{}');
  end loop;
  perform t.expect_error($q$insert into storage.objects (bucket_id, name, metadata) values ('profile-photos', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/20000000-0000-4000-8000-0000000000ff.jpg', '{}')$q$, 'row-level security');
  perform t.pass('storage: at most 12 objects per user');
end $$;

/* ---- A completes onboarding ---- */
select t.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$ declare c1 timestamptz; c2 timestamptz; begin
  c1 := public.complete_onboarding();
  c2 := public.complete_onboarding();
  assert c1 is not null and c1 = c2, 'completion is idempotent';
  perform public.set_onboarding_step('basics');
  assert (select current_step from public.onboarding_state) = 'review', 'step frozen after completion';
  perform t.expect_error($q$select public.save_basics('Alice', (current_date - interval '40 years')::date, '')$q$, 'LOVOKI_DOB_LOCKED');
  perform public.save_basics('Alice A', (current_date - interval '30 years')::date, 'she/her');
  perform public.delete_photo((select id from public.profile_photos where position = 5));
  perform public.delete_photo((select id from public.profile_photos where position = 4));
  perform public.delete_photo((select id from public.profile_photos where position = 3));
  perform public.delete_photo((select id from public.profile_photos where position = 2));
  perform public.delete_photo((select id from public.profile_photos where position = 1));
  perform t.expect_error($q$select public.delete_photo((select id from public.profile_photos limit 1))$q$, 'LOVOKI_LAST_PHOTO');
  assert (select count(*) from public.profile_photos) = 1, 'one photo must remain on a completed profile';
  perform t.pass('completion validated from stored data; date of birth locks; last photo cannot be removed after completion');
end $$;

/* ---- B: cannot touch A, and A is visible only through the views ---- */
select t.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$ declare n int; begin
  perform public.save_basics('Bob', (current_date - interval '28 years')::date, '');
  perform t.as_admin();
  assert (select display_name from public.profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 'Alice A', 'B save_basics did not touch A';
  assert (select display_name from public.profiles where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 'Bob', 'B save_basics wrote B';
  perform t.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  perform t.expect_error($q$select public.delete_photo((select id from public.profile_photos limit 1))$q$, 'LOVOKI_NOT_FOUND');
  assert (select count(*) from public.profile_photos) = 0, 'B cannot read A photo rows';
  delete from storage.objects where name like 'aaaaaaaa%'; get diagnostics n = row_count;
  assert n = 0, 'B cannot delete A objects';
  perform t.expect_error($q$insert into storage.objects (bucket_id, name, metadata) values ('profile-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/30000000-0000-4000-8000-000000000001.jpg', '{}')$q$, 'row-level security');
  perform t.pass('B cannot modify or delete A rows or objects');
end $$;

do $$ begin
  assert (select count(*) from public.public_profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1, 'B sees completed public A';
  assert (select age from public.public_profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 30, 'age, not date of birth';
  assert (select count(*) from public.public_profiles where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 0, 'incomplete profile is not public';
  assert (select count(*) from public.discoverable_profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1, 'A discoverable';
  perform t.expect_error($q$select date_of_birth from public.public_profiles$q$, 'does not exist');
  perform t.expect_error($q$select date_of_birth from public.discoverable_profiles$q$, 'does not exist');
  assert (select count(*) from storage.objects where name like 'aaaaaaaa%') > 0, 'B can read A photos while A is visible';
  perform t.pass('views expose age only and honour completion and visibility');
end $$;

select t.as_admin();
do $$ declare cols text; begin
  select string_agg(column_name, ',' order by column_name) into cols from information_schema.columns
    where table_schema = 'public' and table_name = 'public_profiles';
  assert cols = 'age,area_label,bio,display_name,intention,pronouns,user_id', 'public_profiles columns: ' || cols;
  select string_agg(column_name, ',' order by column_name) into cols from information_schema.columns
    where table_schema = 'public' and table_name = 'discoverable_profiles';
  assert cols = 'age,area_label,bio,display_name,intention,pronouns,user_id', 'discoverable_profiles columns: ' || cols;
  perform t.pass('view column lists are exactly the intended public fields');
end $$;

select t.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.save_privacy('Kochi, Kerala', 'followers', false);
select t.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$ begin
  assert (select count(*) from public.public_profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0, 'followers-only hides from public view';
  assert (select count(*) from public.discoverable_profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0, 'not discoverable hides from discovery view';
  assert (select count(*) from storage.objects where name like 'aaaaaaaa%') = 0, 'B cannot read A photos once A is hidden';
  perform t.pass('turning off visibility and discoverability hides profile and photos');
end $$;
select t.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.save_privacy('Kochi, Kerala', 'followers', true);
select t.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$ begin
  assert (select count(*) from public.public_profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0, 'social stays hidden';
  assert (select count(*) from public.discoverable_profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1, 'dating discoverability is independent of social visibility';
  perform t.pass('social visibility and dating discoverability are independent');
end $$;

/* ---- anonymous and unauthenticated access ---- */
select t.as_anon();
do $$ declare n int; begin
  perform t.expect_error($q$select * from public.profiles$q$, 'permission denied');
  perform t.expect_error($q$select * from public.profiles_private$q$, 'permission denied');
  perform t.expect_error($q$select * from public.public_profiles$q$, 'permission denied');
  perform t.expect_error($q$select * from public.interests$q$, 'permission denied');
  perform t.expect_error($q$select public.ensure_account()$q$, 'permission denied');
  perform t.expect_error($q$select public.save_basics('x', '1990-01-01', '')$q$, 'permission denied');
  perform t.expect_error($q$select public.can_view_photos_of('x')$q$, 'permission denied');
  select count(*) into n from storage.objects; assert n = 0, 'anon reads no objects';
  perform t.expect_error($q$insert into storage.objects (bucket_id, name, metadata) values ('profile-photos','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000bb.jpg','{}')$q$, 'row-level security');
  perform t.pass('anonymous role: no table, view, function or storage access');
end $$;

select t.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  perform t.expect_error($q$select public.ensure_account()$q$, 'LOVOKI_UNAUTHENTICATED');
  assert (select count(*) from public.profiles) = 0, 'a token without a subject reads nothing';
  perform t.pass('authenticated role without a user id reads and writes nothing');
end $$;

/* ---- partially completed setup repairs itself without duplicates ---- */
select t.as_admin();
delete from public.onboarding_state where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
delete from public.dating_preferences where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select t.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$ begin
  perform public.ensure_account();
  assert (select count(*) from public.onboarding_state) = 1 and (select count(*) from public.dating_preferences) = 1, 'missing rows recreated once';
  assert (select display_name from public.profiles) = 'Bob', 'existing data untouched';
  perform t.pass('partially created accounts self-heal without duplicates or data loss');
end $$;

/* ---- cascade ---- */
select t.as_admin();
delete from auth.users where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$ begin
  assert (select count(*) from public.profiles where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') = 0, 'cascade';
  perform t.pass('deleting an auth user removes their rows');
end $$;

\echo ALL DATABASE TESTS PASSED
