-- LOVOKI Phase 2 foundation: accounts, profiles, preferences, photos, onboarding, access control.
-- Apply ONLY to a local or explicitly identified development Supabase project (see docs/PHASE_2_SETUP.md).
--
-- Security model
--   * Every table below is owner-only: RLS lets a signed-in user SELECT only their own rows, and
--     the client roles have NO insert/update/delete privileges. All writes go through the
--     SECURITY DEFINER functions in this file, which validate input and use auth.uid().
--   * RLS cannot hide columns. Date of birth therefore lives in its own owner-only table
--     (profiles_private) and other people only ever read the explicit-column views
--     public_profiles / discoverable_profiles, which expose age (never date of birth).
--   * No service-role key is needed or used by the browser.

begin;

/* ------------------------------------------------------------------ helpers */

create function public.is_adult_on(dob date, ref date, min_years int default 18)
returns boolean language sql immutable parallel safe
as $$ select dob is not null and dob <= (ref - make_interval(years => min_years))::date $$;

create function public.age_of(dob date)
returns int language sql stable parallel safe
as $$ select case when dob is null then null else extract(year from age(current_date, dob))::int end $$;

create function public.touch_updated_at()
returns trigger language plpgsql
as $$ begin new.updated_at = now(); return new; end $$;

/* ------------------------------------------------------------------- tables */

-- Private: owner-only. Never joined into anything another user can read, except through age_of().
create table public.profiles_private (
  user_id uuid primary key references auth.users (id) on delete cascade,
  date_of_birth date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.guard_date_of_birth()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.date_of_birth is not null
     and (tg_op = 'INSERT' or new.date_of_birth is distinct from old.date_of_birth) then
    if not public.is_adult_on(new.date_of_birth, current_date) then
      raise exception 'LOVOKI_UNDER_18' using errcode = 'P0001';
    end if;
    if new.date_of_birth < (current_date - interval '120 years')::date then
      raise exception 'LOVOKI_DOB_IMPLAUSIBLE' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_private_guard_dob before insert or update on public.profiles_private
  for each row execute function public.guard_date_of_birth();

-- Public-facing profile fields (still owner-only at the table level; others read via views).
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  pronouns text not null default '' check (char_length(pronouns) <= 30),
  bio text not null default '' check (char_length(bio) <= 300),
  intention text check (intention is null or intention in
    ('long-term', 'long-term-open', 'short-term-open', 'figuring-out', 'friends-first')),
  area_label text not null default '' check (char_length(area_label) <= 80),
  social_visibility text not null default 'public' check (social_visibility in ('public', 'followers')),
  dating_discoverable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dating_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  interested_in text[] not null default '{}' check (interested_in <@ array['women', 'men', 'non-binary']::text[]),
  age_min smallint not null default 18 check (age_min between 18 and 99),
  age_max smallint not null default 60 check (age_max between 18 and 99),
  max_distance_km smallint check (max_distance_km is null or max_distance_km between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (age_min <= age_max)
);

create table public.interests (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label text not null unique
);

create table public.profile_interests (
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null references public.interests (slug),
  primary key (user_id, slug)
);

create table public.profile_prompts (
  user_id uuid not null references auth.users (id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  question text not null check (char_length(btrim(question)) between 1 and 60),
  answer text not null check (char_length(btrim(answer)) between 1 and 160),
  primary key (user_id, position),
  unique (user_id, question)
);

create table public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique,
  position smallint not null check (position between 0 and 5),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  constraint photo_path_owner check (storage_path ~
    ('^' || user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')),
  constraint photo_position_unique unique (user_id, position) deferrable initially deferred
);

create table public.onboarding_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  current_step text not null default 'basics'
    check (current_step in ('basics', 'about', 'preferences', 'photos', 'privacy', 'review')),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger profiles_private_touch before update on public.profiles_private for each row execute function public.touch_updated_at();
create trigger dating_preferences_touch before update on public.dating_preferences for each row execute function public.touch_updated_at();
create trigger onboarding_state_touch before update on public.onboarding_state for each row execute function public.touch_updated_at();

insert into public.interests (slug, label) values
  ('afrobeats', 'Afrobeats'),
  ('architecture', 'Architecture'),
  ('baking', 'Baking'),
  ('board-games', 'Board games'),
  ('bookshops', 'Bookshops'),
  ('cats', 'Cats'),
  ('ceramics', 'Ceramics'),
  ('climbing', 'Climbing'),
  ('coding', 'Coding'),
  ('coffee', 'Coffee'),
  ('cooking', 'Cooking'),
  ('cycling', 'Cycling'),
  ('design', 'Design'),
  ('diving', 'Diving'),
  ('drumming', 'Drumming'),
  ('film', 'Film'),
  ('football', 'Football'),
  ('gardening', 'Gardening'),
  ('hiking', 'Hiking'),
  ('jazz', 'Jazz'),
  ('languages', 'Languages'),
  ('markets', 'Markets'),
  ('music', 'Music'),
  ('painting', 'Painting'),
  ('photography', 'Photography'),
  ('poetry', 'Poetry'),
  ('running', 'Running'),
  ('skiing', 'Skiing'),
  ('street-food', 'Street food'),
  ('swimming', 'Swimming'),
  ('tango', 'Tango'),
  ('transit', 'Transit'),
  ('vinyl', 'Vinyl'),
  ('writing', 'Writing');

/* ------------------------------------------------- RLS + privileges (owner-only) */

do $$
declare t text;
begin
  foreach t in array array['profiles_private', 'profiles', 'dating_preferences', 'profile_interests',
                           'profile_prompts', 'profile_photos', 'onboarding_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
                   t || '_select_own', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

alter table public.interests enable row level security;
create policy interests_select_all on public.interests for select to authenticated using (true);
revoke all on table public.interests from public, anon, authenticated;
grant select on table public.interests to authenticated;

/* --------------------------------------------------------- account creation */

create function public._require_uid()
returns uuid language plpgsql stable set search_path = ''
as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'LOVOKI_UNAUTHENTICATED' using errcode = '28000'; end if;
  return u;
end $$;

-- Idempotent: safe to call from the signup trigger AND from the client after any partial failure.
create function public._create_account_rows(p_user uuid)
returns void language sql security definer set search_path = ''
as $$
  insert into public.profiles_private (user_id) values (p_user) on conflict do nothing;
  insert into public.profiles (user_id) values (p_user) on conflict do nothing;
  insert into public.dating_preferences (user_id) values (p_user) on conflict do nothing;
  insert into public.onboarding_state (user_id) values (p_user) on conflict do nothing;
$$;

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin perform public._create_account_rows(new.id); return new; end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.ensure_account()
returns void language plpgsql security definer set search_path = ''
as $$ begin perform public._create_account_rows(public._require_uid()); end $$;

/* ------------------------------------------------------------ write functions */

create function public.save_basics(p_display_name text, p_date_of_birth date, p_pronouns text default '')
returns void language plpgsql security definer set search_path = ''
as $$
declare
  u uuid := public._require_uid();
  n text := btrim(coalesce(p_display_name, ''));
  done boolean; cur date;
begin
  perform public._create_account_rows(u);
  if char_length(n) not between 1 and 40 then raise exception 'LOVOKI_INVALID: display_name'; end if;
  if char_length(btrim(coalesce(p_pronouns, ''))) > 30 then raise exception 'LOVOKI_INVALID: pronouns'; end if;
  if p_date_of_birth is null then raise exception 'LOVOKI_INVALID: date_of_birth'; end if;
  select completed_at is not null into done from public.onboarding_state where user_id = u;
  select date_of_birth into cur from public.profiles_private where user_id = u;
  if done and cur is not null and p_date_of_birth is distinct from cur then
    raise exception 'LOVOKI_DOB_LOCKED';
  end if;
  update public.profiles_private set date_of_birth = p_date_of_birth where user_id = u; -- trigger enforces 18+
  update public.profiles set display_name = n, pronouns = btrim(coalesce(p_pronouns, '')) where user_id = u;
end $$;

create function public.save_about(p_bio text, p_interests text[], p_prompts jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  u uuid := public._require_uid();
  slugs text[] := coalesce(p_interests, '{}');
  prompts jsonb := coalesce(p_prompts, '[]'::jsonb);
begin
  perform public._create_account_rows(u);
  if char_length(btrim(coalesce(p_bio, ''))) > 300 then raise exception 'LOVOKI_INVALID: bio'; end if;
  if (select count(distinct s) from unnest(slugs) s) > 8 then raise exception 'LOVOKI_INVALID: too many interests'; end if;
  if exists (select 1 from unnest(slugs) s where not exists (select 1 from public.interests i where i.slug = s)) then
    raise exception 'LOVOKI_INVALID: unknown interest';
  end if;
  if jsonb_typeof(prompts) <> 'array' or jsonb_array_length(prompts) > 3 then
    raise exception 'LOVOKI_INVALID: prompts';
  end if;
  update public.profiles set bio = btrim(coalesce(p_bio, '')) where user_id = u;
  delete from public.profile_interests where user_id = u;
  insert into public.profile_interests (user_id, slug) select distinct u, s from unnest(slugs) s;
  delete from public.profile_prompts where user_id = u;
  insert into public.profile_prompts (user_id, position, question, answer)
    select u, ord::smallint, btrim(e ->> 'question'), btrim(e ->> 'answer')
    from jsonb_array_elements(prompts) with ordinality as t(e, ord);
end $$;

create function public.save_preferences(p_intention text, p_interested_in text[], p_age_min int, p_age_max int, p_max_distance int)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  perform public._create_account_rows(u);
  if p_intention is null then raise exception 'LOVOKI_INVALID: intention'; end if;
  if coalesce(cardinality(p_interested_in), 0) = 0 then raise exception 'LOVOKI_INVALID: interested_in'; end if;
  update public.profiles set intention = p_intention where user_id = u;
  update public.dating_preferences
    set interested_in = p_interested_in, age_min = p_age_min, age_max = p_age_max, max_distance_km = p_max_distance
    where user_id = u;
end $$;

create function public.save_privacy(p_area_label text, p_social_visibility text, p_dating_discoverable boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); a text := btrim(coalesce(p_area_label, ''));
begin
  perform public._create_account_rows(u);
  if char_length(a) not between 1 and 80 or a ~ '\d{1,3}\.\d{3,}' then
    raise exception 'LOVOKI_INVALID: area_label';
  end if;
  update public.profiles
    set area_label = a, social_visibility = p_social_visibility, dating_discoverable = coalesce(p_dating_discoverable, false)
    where user_id = u;
end $$;

create function public.set_onboarding_step(p_step text)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  perform public._create_account_rows(u);
  update public.onboarding_state set current_step = p_step where user_id = u and completed_at is null;
end $$;

-- Photos. The object is uploaded to Storage first (policies below), then registered here.
-- Type and size are read from the stored object's own metadata, never from client-supplied values.
create function public.register_photo(p_path text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  u uuid := public._require_uid(); meta jsonb; new_id uuid; pos int;
begin
  perform public._create_account_rows(u);
  if p_path !~ ('^' || u::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$') then
    raise exception 'LOVOKI_INVALID: photo_path';
  end if;
  if (select count(*) from public.profile_photos where user_id = u) >= 6 then raise exception 'LOVOKI_PHOTO_LIMIT'; end if;
  select o.metadata into meta from storage.objects o where o.bucket_id = 'profile-photos' and o.name = p_path;
  if meta is null or meta ->> 'mimetype' is null or meta ->> 'size' is null then raise exception 'LOVOKI_PHOTO_MISSING'; end if;
  select coalesce(max(position) + 1, 0) into pos from public.profile_photos where user_id = u;
  insert into public.profile_photos (user_id, storage_path, position, content_type, size_bytes)
    values (u, p_path, pos, meta ->> 'mimetype', (meta ->> 'size')::int)
    returning id into new_id;
  return new_id;
end $$;

create function public.reorder_photos(p_ids uuid[])
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  if (select array_agg(id order by id) from public.profile_photos where user_id = u)
     is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'LOVOKI_INVALID: photo_ids';
  end if;
  update public.profile_photos p set position = (o.ord - 1)::smallint
    from unnest(p_ids) with ordinality as o(id, ord) where p.id = o.id and p.user_id = u;
end $$;

-- Returns the storage path so the client can remove the object. If that removal fails the object is
-- an orphan: it is private, owner-only, capped by the per-user object limit, and swept by the client.
create function public.delete_photo(p_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); gone text;
begin
  if exists (select 1 from public.onboarding_state where user_id = u and completed_at is not null)
     and (select count(*) from public.profile_photos where user_id = u) <= 1 then
    raise exception 'LOVOKI_LAST_PHOTO';
  end if;
  delete from public.profile_photos where id = p_id and user_id = u returning storage_path into gone;
  if gone is null then raise exception 'LOVOKI_NOT_FOUND'; end if;
  update public.profile_photos p set position = (r.rn - 1)::smallint
    from (select id, row_number() over (order by position) as rn from public.profile_photos where user_id = u) r
    where p.id = r.id;
  return gone;
end $$;

-- Completion is decided here, from stored data. The client cannot set completed_at.
create function public.complete_onboarding()
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare
  u uuid := public._require_uid(); missing text[] := '{}'; p public.profiles; d public.dating_preferences;
  dob date; photos int; done timestamptz;
begin
  perform public._create_account_rows(u);
  select * into p from public.profiles where user_id = u;
  select * into d from public.dating_preferences where user_id = u;
  select date_of_birth into dob from public.profiles_private where user_id = u;
  select count(*) into photos from public.profile_photos where user_id = u;
  if coalesce(btrim(p.display_name), '') = '' then missing := array_append(missing, 'displayName'); end if;
  if dob is null or not public.is_adult_on(dob, current_date) then missing := array_append(missing, 'dateOfBirth'); end if;
  if p.intention is null then missing := array_append(missing, 'intention'); end if;
  if coalesce(cardinality(d.interested_in), 0) = 0 then missing := array_append(missing, 'interestedIn'); end if;
  if photos < 1 then missing := array_append(missing, 'photos'); end if;
  if btrim(p.area_label) = '' then missing := array_append(missing, 'areaLabel'); end if;
  if cardinality(missing) > 0 then
    raise exception 'LOVOKI_ONBOARDING_INCOMPLETE:%', array_to_string(missing, ',');
  end if;
  update public.onboarding_state set completed_at = coalesce(completed_at, now()), current_step = 'review'
    where user_id = u returning completed_at into done;
  return done;
end $$;

/* ----------------------------------------------- the only cross-user read paths */

-- Explicit columns only. Owner-rights views, so they bypass table RLS on purpose; the WHERE clause is the policy.
create view public.public_profiles with (security_barrier = true) as
  select p.user_id, p.display_name, p.pronouns, p.bio, p.intention, p.area_label, public.age_of(pr.date_of_birth) as age
  from public.profiles p
  join public.profiles_private pr on pr.user_id = p.user_id
  join public.onboarding_state o on o.user_id = p.user_id
  where o.completed_at is not null and p.social_visibility = 'public';

create view public.discoverable_profiles with (security_barrier = true) as
  select p.user_id, p.display_name, p.pronouns, p.bio, p.intention, p.area_label, public.age_of(pr.date_of_birth) as age
  from public.profiles p
  join public.profiles_private pr on pr.user_id = p.user_id
  join public.onboarding_state o on o.user_id = p.user_id
  where o.completed_at is not null and p.dating_discoverable;

revoke all on public.public_profiles, public.discoverable_profiles from public, anon, authenticated;
grant select on public.public_profiles, public.discoverable_profiles to authenticated;

/* ----------------------------------------------------------- function grants */

do $$
declare f text;
begin
  foreach f in array array[
    'public._require_uid()', 'public._create_account_rows(uuid)', 'public.handle_new_user()',
    'public.ensure_account()', 'public.save_basics(text,date,text)', 'public.save_about(text,text[],jsonb)',
    'public.save_preferences(text,text[],int,int,int)', 'public.save_privacy(text,text,boolean)',
    'public.set_onboarding_step(text)', 'public.register_photo(text)', 'public.reorder_photos(uuid[])',
    'public.delete_photo(uuid)', 'public.complete_onboarding()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.ensure_account()', 'public.save_basics(text,date,text)', 'public.save_about(text,text[],jsonb)',
    'public.save_preferences(text,text[],int,int,int)', 'public.save_privacy(text,text,boolean)',
    'public.set_onboarding_step(text)', 'public.register_photo(text)', 'public.reorder_photos(uuid[])',
    'public.delete_photo(uuid)', 'public.complete_onboarding()'] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

/* ----------------------------------------------------------- photo storage */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- A person's photos are visible to others only while their profile is complete and publicly visible or discoverable.
create function public.can_view_photos_of(p_owner text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p join public.onboarding_state o on o.user_id = p.user_id
    where p.user_id::text = p_owner and o.completed_at is not null
      and (p.social_visibility = 'public' or p.dating_discoverable));
$$;
revoke execute on function public.can_view_photos_of(text) from public, anon;
grant execute on function public.can_view_photos_of(text) to authenticated;

-- Counting inside the policy itself would make Postgres report "infinite recursion detected in policy",
-- so the count lives in a SECURITY DEFINER function that is not subject to the policy it serves.
create function public.own_photo_object_count()
returns int language sql stable security definer set search_path = ''
as $$
  select count(*)::int from storage.objects o
  where o.bucket_id = 'profile-photos' and (storage.foldername(o.name))[1] = (select auth.uid())::text;
$$;
revoke execute on function public.own_photo_object_count() from public, anon;
grant execute on function public.own_photo_object_count() to authenticated;

-- Upload: own folder only, server-generated UUID name, fixed extensions, at most 12 objects per user
-- (6 registered photos plus room for in-flight or orphaned uploads). No UPDATE policy: no overwrites.
create policy "profile photos: upload own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
    and public.own_photo_object_count() < 12);

create policy "profile photos: read own or visible" on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos'
    and ((storage.foldername(name))[1] = (select auth.uid())::text
         or public.can_view_photos_of((storage.foldername(name))[1])));

create policy "profile photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
