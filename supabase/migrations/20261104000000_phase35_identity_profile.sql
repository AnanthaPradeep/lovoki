-- LOVOKI Phase 3.5: identity (username, consent) and the complete profile data model.
-- Apply ONLY to a local or explicitly identified development Supabase project (see docs/HOSTED_SETUP.md).
--
-- Principle: collect only what a visible feature, a filter or a safety function uses. Required fields are minimal;
-- everything else is optional and progressive. Never collected or stored: caste, income, exact address, GPS history,
-- government ID numbers or documents, health conditions, sexual history, immigration status, biometrics.
--
-- Visibility key: P public (anyone who may see the profile), F followers, M matches only, X private to the owner.
-- Per-field visibility lives in profile_details.visibility (a validated jsonb column). Every read of another person's
-- optional fields goes through _can_see_field(), so one function decides.
--
-- Places: a places table (GeoNames, CC-BY 4.0, see docs/ATTRIBUTION.md) is searched by name. A profile stores only the place
-- and a coordinate rounded to a 0.05 degree grid (about 5 km). Clients never receive coordinates, ever: not in the places
-- search, not for their own profile.

begin;

create extension if not exists citext with schema extensions;

/* ------------------------------------------------------------ profile columns */

alter table public.profiles
  add column username extensions.citext,
  add column username_changed_at timestamptz,
  add column gender_custom text check (gender_custom is null or char_length(btrim(gender_custom)) between 1 and 30),
  add column avatar_photo_id uuid references public.profile_photos (id) on delete set null,
  add column avatar_crop jsonb,
  add column allow_comments text not null default 'everyone' check (allow_comments in ('everyone', 'followers', 'nobody')),
  add column show_follower_counts boolean not null default true;

alter table public.profiles drop constraint if exists profiles_gender_check;
alter table public.profiles add constraint profiles_gender_check check (gender in ('woman', 'man', 'non-binary', 'self-describe'));
alter table public.profiles add constraint profiles_gender_custom_only check ((gender = 'self-describe') = (gender_custom is not null) or gender is null);
alter table public.profiles add constraint profiles_username_shape check (
  username is null or (username::text ~ '^[a-z0-9._]{3,30}$' and username::text !~ '(^\.|\.$|\.\.)'));
alter table public.profiles add constraint profiles_avatar_crop_shape check (
  avatar_crop is null or (jsonb_typeof(avatar_crop) = 'object' and (avatar_crop ->> 'x')::numeric between 0 and 1
    and (avatar_crop ->> 'y')::numeric between 0 and 1 and (avatar_crop ->> 'zoom')::numeric between 1 and 3));
create unique index profiles_username_key on public.profiles (username) where username is not null;

create table public.username_history (
  handle extensions.citext primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  reserved_until timestamptz not null
);

alter table public.dating_preferences
  add column filter_height_min smallint check (filter_height_min is null or filter_height_min between 120 and 230),
  add column filter_height_max smallint check (filter_height_max is null or filter_height_max between 120 and 230),
  add column filter_drinking text[] not null default '{}' check (filter_drinking <@ array['never', 'rarely', 'socially', 'often']::text[]),
  add column filter_smoking text[] not null default '{}' check (filter_smoking <@ array['never', 'sometimes', 'regularly']::text[]),
  add column filter_kids text[] not null default '{}' check (filter_kids <@ array['no', 'yes', 'open']::text[]),
  add constraint filter_height_order check (filter_height_min is null or filter_height_max is null or filter_height_min <= filter_height_max);

/* ----------------------------------------------------------------- details */

create function public._default_visibility(k text) returns text language sql immutable set search_path = ''
as $$ select case k when 'instagram' then 'M' when 'work' then 'M' when 'religion' then 'X' else 'P' end $$;

create function public._valid_visibility(v jsonb) returns boolean language sql immutable set search_path = ''
as $$
  select jsonb_typeof(v) = 'object' and not exists (
    select 1 from jsonb_each_text(v) e
    where e.key <> all (array['instagram', 'height', 'work', 'education', 'languages', 'lifestyle', 'kids', 'structure', 'religion'])
       or e.value <> all (array['P', 'F', 'M', 'X']))
$$;

create table public.languages (code text primary key check (code ~ '^[a-z]{2}$'), name text not null unique);
insert into public.languages (code, name) values
  ('en', 'English'), ('hi', 'Hindi'), ('ta', 'Tamil'), ('ml', 'Malayalam'), ('te', 'Telugu'), ('kn', 'Kannada'), ('bn', 'Bengali'), ('mr', 'Marathi'),
  ('gu', 'Gujarati'), ('pa', 'Punjabi'), ('ur', 'Urdu'), ('or', 'Odia'), ('as', 'Assamese'), ('ne', 'Nepali'), ('si', 'Sinhala'), ('es', 'Spanish'),
  ('fr', 'French'), ('de', 'German'), ('it', 'Italian'), ('pt', 'Portuguese'), ('ru', 'Russian'), ('ar', 'Arabic'), ('zh', 'Chinese'), ('ja', 'Japanese'),
  ('ko', 'Korean'), ('id', 'Indonesian'), ('ms', 'Malay'), ('th', 'Thai'), ('vi', 'Vietnamese'), ('tr', 'Turkish'), ('fa', 'Persian'), ('he', 'Hebrew'),
  ('pl', 'Polish'), ('nl', 'Dutch'), ('sv', 'Swedish'), ('no', 'Norwegian'), ('da', 'Danish'), ('fi', 'Finnish'), ('el', 'Greek'), ('cs', 'Czech'),
  ('ro', 'Romanian'), ('hu', 'Hungarian'), ('uk', 'Ukrainian'), ('sw', 'Swahili'), ('am', 'Amharic'), ('ha', 'Hausa'), ('yo', 'Yoruba'), ('zu', 'Zulu'),
  ('af', 'Afrikaans'), ('tl', 'Filipino');

create table public.profile_details (
  user_id uuid primary key references auth.users (id) on delete cascade,
  instagram_handle text check (instagram_handle is null or (instagram_handle ~ '^[a-z0-9._]{1,30}$' and instagram_handle !~ '\.\.')),
  height_cm smallint check (height_cm is null or height_cm between 120 and 230),
  job_title text check (job_title is null or char_length(btrim(job_title)) between 1 and 60),
  company_or_school text check (company_or_school is null or char_length(btrim(company_or_school)) between 1 and 60),
  education_level text check (education_level in ('high-school', 'trade', 'some-college', 'bachelors', 'masters', 'doctorate', 'other')),
  languages text[] not null default '{}' check (cardinality(languages) <= 10),
  drinking text check (drinking in ('never', 'rarely', 'socially', 'often')),
  smoking text check (smoking in ('never', 'sometimes', 'regularly')),
  exercise text check (exercise in ('never', 'sometimes', 'often', 'daily')),
  diet text check (diet in ('vegetarian', 'eggetarian', 'vegan', 'non-vegetarian', 'pescatarian', 'other')),
  pets text[] not null default '{}' check (pets <@ array['dog', 'cat', 'bird', 'fish', 'other']::text[]),
  has_kids text check (has_kids in ('no', 'yes')),
  wants_kids text check (wants_kids in ('no', 'yes', 'open')),
  relationship_structure text check (relationship_structure in ('monogamy', 'ethical-non-monogamy', 'open-to-discuss')),
  -- SENSITIVE. Only stored after an explicit opt-in call, hidden (X) by default, display only, never a filter.
  religion text check (religion in ('hindu', 'muslim', 'christian', 'sikh', 'buddhist', 'jain', 'jewish', 'spiritual', 'atheist', 'agnostic', 'other')),
  visibility jsonb not null default '{}' check (public._valid_visibility(visibility)),
  updated_at timestamptz not null default now()
);
create trigger profile_details_touch before update on public.profile_details for each row execute function public.touch_updated_at();
insert into public.profile_details (user_id) select user_id from public.profiles on conflict do nothing;

create or replace function public._create_account_rows(p_user uuid)
returns void language sql security definer set search_path = ''
as $$
  insert into public.profiles_private (user_id) values (p_user) on conflict do nothing;
  insert into public.profiles (user_id) values (p_user) on conflict do nothing;
  insert into public.dating_preferences (user_id) values (p_user) on conflict do nothing;
  insert into public.onboarding_state (user_id) values (p_user) on conflict do nothing;
  insert into public.profile_details (user_id) values (p_user) on conflict do nothing;
$$;

create table public.consents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  terms_version text not null check (char_length(terms_version) between 1 and 40),
  confirmed_18 boolean not null check (confirmed_18),
  accepted_at timestamptz not null default now(),
  marketing boolean not null default false,
  marketing_changed_at timestamptz
);

/* ------------------------------------------------------------------- places */

create table public.places (
  id int primary key,
  name text not null,
  region text not null default '',
  country_code char(2) not null,
  country text not null,
  lat numeric(6, 3) not null,
  lng numeric(6, 3) not null,
  population int not null default 0
);
create index places_name_idx on public.places (lower(name) text_pattern_ops);
create index places_pop_idx on public.places (population desc);

alter table public.profile_places add column place_id int references public.places (id);
update public.profile_places set lat = round(lat * 20) / 20, lng = round(lng * 20) / 20; -- re-round Phase 4 rows to the 5 km grid
drop function public.save_place(text, numeric, numeric);
drop policy profile_places_select_own on public.profile_places;
revoke select on public.profile_places from authenticated; -- clients never read coordinates, not even their own

do $$
declare t text;
begin
  foreach t in array array['username_history', 'profile_details', 'consents', 'places', 'languages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;
create policy profile_details_select_own on public.profile_details for select to authenticated using (user_id = (select auth.uid()));
create policy consents_select_own on public.consents for select to authenticated using (user_id = (select auth.uid()));
create policy languages_select_all on public.languages for select to authenticated using (true);
grant select on public.profile_details, public.consents, public.languages to authenticated;

/* ---------------------------------------------------------------- catalogs */

insert into public.interests (slug, label) values
  ('anime', 'Anime'), ('astronomy', 'Astronomy'), ('badminton', 'Badminton'), ('basketball', 'Basketball'), ('birdwatching', 'Birdwatching'),
  ('bollywood', 'Bollywood'), ('camping', 'Camping'), ('carnatic-music', 'Carnatic music'), ('chess', 'Chess'), ('cricket', 'Cricket'),
  ('dancing', 'Dancing'), ('fashion', 'Fashion'), ('fishing', 'Fishing'), ('fitness', 'Fitness'), ('gaming', 'Gaming'), ('history', 'History'),
  ('karaoke', 'Karaoke'), ('kabaddi', 'Kabaddi'), ('knitting', 'Knitting'), ('martial-arts', 'Martial arts'), ('meditation', 'Meditation'),
  ('motorcycles', 'Motorcycles'), ('museums', 'Museums'), ('podcasts', 'Podcasts'), ('reading', 'Reading'), ('road-trips', 'Road trips'),
  ('sailing', 'Sailing'), ('skateboarding', 'Skateboarding'), ('stand-up-comedy', 'Stand-up comedy'), ('street-photography', 'Street photography'),
  ('tea', 'Tea'), ('tennis', 'Tennis'), ('theatre', 'Theatre'), ('thrifting', 'Thrifting'), ('travel', 'Travel'), ('trekking', 'Trekking'),
  ('volleyball', 'Volleyball'), ('volunteering', 'Volunteering'), ('woodworking', 'Woodworking'), ('yoga', 'Yoga')
on conflict do nothing;

/* ------------------------------------------------------------- consent */

create function public.record_consent(p_terms_version text, p_confirm_18 boolean, p_marketing boolean default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); v text := btrim(coalesce(p_terms_version, ''));
begin
  perform public._create_account_rows(u);
  if char_length(v) not between 1 and 40 or p_confirm_18 is distinct from true then raise exception 'LOVOKI_INVALID: consent'; end if;
  insert into public.consents (user_id, terms_version, confirmed_18, marketing, marketing_changed_at)
    values (u, v, true, coalesce(p_marketing, false), case when p_marketing is not null then now() end)
    on conflict (user_id) do update set terms_version = excluded.terms_version, confirmed_18 = true, accepted_at = now(),
      marketing = coalesce(p_marketing, public.consents.marketing),
      marketing_changed_at = case when p_marketing is not null and p_marketing <> public.consents.marketing then now() else public.consents.marketing_changed_at end;
end $$;

create function public.set_marketing_consent(p_on boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  update public.consents set marketing = coalesce(p_on, false), marketing_changed_at = now() where user_id = u;
  if not found then raise exception 'LOVOKI_CONSENT_REQUIRED'; end if;
end $$;

-- Sign-up sends the consent as user metadata (terms_version, confirm_18, marketing). The server records it with its own clock.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  perform public._create_account_rows(new.id);
  if char_length(btrim(coalesce(m ->> 'terms_version', ''))) between 1 and 40 and (m ->> 'confirm_18') = 'true' then
    insert into public.consents (user_id, terms_version, confirmed_18, marketing, marketing_changed_at)
      values (new.id, btrim(m ->> 'terms_version'), true, (m ->> 'marketing') = 'true', case when (m ->> 'marketing') = 'true' then now() end)
      on conflict (user_id) do nothing;
  end if;
  return new;
end $$;

/* ------------------------------------------------------------ usernames */

create function public._reserved_handle(h text) returns boolean language sql immutable set search_path = ''
as $$
  select lower(h) = any (array['admin', 'administrator', 'support', 'lovoki', 'help', 'root', 'system', 'moderator', 'mod', 'staff', 'official',
    'security', 'abuse', 'postmaster', 'null', 'undefined', 'api', 'www', 'terms', 'privacy', 'settings', 'me', 'feed', 'discover', 'connections',
    'messages', 'notifications', 'login', 'logout', 'signup', 'register', 'about', 'contact', 'team', 'news', 'blog', 'press', 'legal', 'safety',
    'trust', 'billing', 'payments', 'noreply', 'no.reply', 'info', 'hello', 'home', 'app', 'u', 'p', 'onboarding', 'welcome'])
$$;

-- 'invalid' | 'reserved' | 'unavailable' (taken, or released by someone in the last 30 days: the same answer on purpose) | 'available'
create function public._handle_status(h text, me uuid) returns text language plpgsql stable security definer set search_path = ''
as $$
begin
  if h !~ '^[a-z0-9._]{3,30}$' or h ~ '(^\.|\.$|\.\.)' then return 'invalid'; end if;
  if public._reserved_handle(h) then return 'reserved'; end if;
  if exists (select 1 from public.profiles where username = h::extensions.citext and user_id <> me) then return 'unavailable'; end if;
  if exists (select 1 from public.username_history where handle = h::extensions.citext and reserved_until > now()) then return 'unavailable'; end if;
  return 'available';
end $$;

create function public.check_username(p_handle text) returns text language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  perform public._rate_hit('username_check', 60, 'hour');
  return public._handle_status(lower(btrim(coalesce(p_handle, ''))), u);
end $$;

-- First claim, and any change before onboarding completes, is free. After that: once per 30 days, and the old handle is held for 30 days.
create function public.set_username(p_handle text) returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); h text := lower(btrim(coalesce(p_handle, ''))); cur text; changed timestamptz; done boolean; st text;
begin
  perform public._create_account_rows(u);
  perform public._rate_hit('username_set', 30, 'hour');
  select username::text, username_changed_at into cur, changed from public.profiles where user_id = u;
  if cur = h then return; end if;
  st := public._handle_status(h, u);
  if st in ('invalid', 'reserved') then raise exception 'LOVOKI_USERNAME_%', upper(st); end if;
  if st = 'unavailable' then raise exception 'LOVOKI_USERNAME_UNAVAILABLE'; end if;
  done := public._is_completed(u);
  if cur is not null and done and changed is not null and changed > now() - interval '30 days' then raise exception 'LOVOKI_USERNAME_COOLDOWN'; end if;
  delete from public.username_history where reserved_until < now();
  if cur is not null and done then
    insert into public.username_history (handle, user_id, reserved_until) values (cur::extensions.citext, u, now() + interval '30 days')
      on conflict (handle) do update set user_id = excluded.user_id, reserved_until = excluded.reserved_until;
  end if;
  begin
    update public.profiles set username = h::extensions.citext, username_changed_at = case when cur is not null and done then now() else username_changed_at end where user_id = u;
  exception when unique_violation then raise exception 'LOVOKI_USERNAME_UNAVAILABLE';
  end;
end $$;

create function public.resolve_username(p_handle text) returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); t uuid;
begin
  select user_id into t from public.profiles where username = lower(btrim(coalesce(p_handle, '')))::extensions.citext;
  if t is null or public._blocked_between(u, t) or not public._is_completed(t) then return null; end if;
  return t;
end $$;

/* ------------------------------------------------------------------ places */

create function public.search_places(p_query text, p_limit int default 8)
returns table (id int, name text, region text, country_code text, country text, label text)
language plpgsql security definer set search_path = ''
as $$
declare q text := replace(replace(lower(btrim(coalesce(p_query, ''))), '%', ''), '_', '');
begin
  perform public._require_uid();
  perform public._rate_hit('places', 300, 'hour');
  if char_length(q) < 2 or char_length(q) > 60 then return; end if;
  return query
    select p.id, p.name, p.region, p.country_code::text, p.country,
           p.name || case when p.region <> '' and p.region <> p.name then ', ' || p.region else '' end || ', ' || p.country
    from public.places p where lower(p.name) like q || '%'
    order by p.population desc, p.id limit least(greatest(coalesce(p_limit, 8), 1), 10);
end $$;

-- "Use my current location": the browser asks only after a click and sends one point here. The point is mapped to the nearest
-- places and is NOT stored or logged by this function; only the chosen place is ever saved.
create function public.nearest_places(p_lat numeric, p_lng numeric, p_limit int default 3)
returns table (id int, name text, region text, country_code text, country text, label text)
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_uid();
  perform public._rate_hit('places', 300, 'hour');
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'LOVOKI_INVALID: location'; end if;
  return query
    select p.id, p.name, p.region, p.country_code::text, p.country,
           p.name || case when p.region <> '' and p.region <> p.name then ', ' || p.region else '' end || ', ' || p.country
    from public.places p order by public._haversine_km(p_lat, p_lng, p.lat, p.lng), p.population desc limit least(greatest(coalesce(p_limit, 3), 1), 5);
end $$;

create function public.save_place_id(p_place_id int) returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); p public.places;
begin
  perform public._create_account_rows(u);
  select * into p from public.places where id = p_place_id;
  if p.id is null then raise exception 'LOVOKI_INVALID: place'; end if;
  -- Stored on a 0.05 degree grid (about 5 km) so even the database holds nothing finer than a neighbourhood-of-a-city.
  insert into public.profile_places (user_id, place_id, lat, lng)
    values (u, p.id, round(p.lat * 20) / 20, round(p.lng * 20) / 20)
    on conflict (user_id) do update set place_id = excluded.place_id, lat = excluded.lat, lng = excluded.lng, updated_at = now();
  update public.profiles set area_label = left(p.name || case when p.region <> '' and p.region <> p.name then ', ' || p.region else '' end, 80) where user_id = u;
end $$;

create function public.my_place()
returns table (place_id int, name text, region text, country_code text, country text, label text)
language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  return query
    select pl.place_id, p.name, p.region, p.country_code::text, p.country, pr.area_label
    from public.profile_places pl join public.profiles pr on pr.user_id = pl.user_id left join public.places p on p.id = pl.place_id where pl.user_id = u;
end $$;

/* ------------------------------------------------------- own profile saves */

create or replace function public.save_dating_profile(p_gender text, p_show_gender boolean, p_show_distance boolean, p_gender_custom text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); c text := nullif(btrim(coalesce(p_gender_custom, '')), '');
begin
  perform public._create_account_rows(u);
  if p_gender is null or p_gender not in ('woman', 'man', 'non-binary', 'self-describe') then raise exception 'LOVOKI_INVALID: gender'; end if;
  -- eslint-disable-next-line: control characters are refused so the label is always plain text
  if p_gender = 'self-describe' and (c is null or char_length(c) > 30 or c ~ '[[:cntrl:]]') then raise exception 'LOVOKI_INVALID: gender_custom'; end if;
  update public.profiles set gender = p_gender, gender_custom = case when p_gender = 'self-describe' then c end,
    show_gender = coalesce(p_show_gender, true), show_distance = coalesce(p_show_distance, true) where user_id = u;
end $$;
drop function public.save_dating_profile(text, boolean, boolean);

create function public.save_avatar(p_photo_id uuid, p_crop jsonb) returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  if p_photo_id is not null and not exists (select 1 from public.profile_photos where id = p_photo_id and user_id = u) then raise exception 'LOVOKI_INVALID: avatar'; end if;
  if p_crop is not null and not (jsonb_typeof(p_crop) = 'object' and (p_crop ->> 'x') ~ '^[0-9.]+$' and (p_crop ->> 'y') ~ '^[0-9.]+$' and (p_crop ->> 'zoom') ~ '^[0-9.]+$'
      and (p_crop ->> 'x')::numeric between 0 and 1 and (p_crop ->> 'y')::numeric between 0 and 1 and (p_crop ->> 'zoom')::numeric between 1 and 3) then
    raise exception 'LOVOKI_INVALID: crop';
  end if;
  update public.profiles set avatar_photo_id = p_photo_id,
    avatar_crop = case when p_photo_id is null then null else jsonb_build_object('x', (p_crop ->> 'x')::numeric, 'y', (p_crop ->> 'y')::numeric, 'zoom', (p_crop ->> 'zoom')::numeric) end
    where user_id = u;
end $$;

create function public.save_social_settings(p_allow_comments text, p_show_follower_counts boolean) returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  if p_allow_comments is null or p_allow_comments not in ('everyone', 'followers', 'nobody') then raise exception 'LOVOKI_INVALID: allow_comments'; end if;
  update public.profiles set allow_comments = p_allow_comments, show_follower_counts = coalesce(p_show_follower_counts, true) where user_id = u;
end $$;

-- A partial update: only the keys present in p_patch change; null clears a field. p_visibility merges per-field choices.
-- Religion is sensitive: it is stored only when the same call carries religion_optin = true, and it stays hidden (X) unless you pick otherwise.
create function public.save_profile_details(p_patch jsonb, p_visibility jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  u uuid := public._require_uid(); k text; v jsonb; d public.profile_details; vis jsonb;
  allowed text[] := array['instagram_handle', 'height_cm', 'job_title', 'company_or_school', 'education_level', 'languages', 'drinking', 'smoking', 'exercise', 'diet',
                          'pets', 'has_kids', 'wants_kids', 'relationship_structure', 'religion', 'religion_optin'];
  s text;
begin
  perform public._create_account_rows(u);
  p_patch := coalesce(p_patch, '{}'::jsonb); p_visibility := coalesce(p_visibility, '{}'::jsonb);
  if jsonb_typeof(p_patch) <> 'object' or jsonb_typeof(p_visibility) <> 'object' then raise exception 'LOVOKI_INVALID: patch'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k <> all (allowed) then raise exception 'LOVOKI_INVALID: field %', k; end if;
  end loop;
  select * into d from public.profile_details where user_id = u;

  if p_patch ? 'instagram_handle' then
    s := nullif(lower(btrim(regexp_replace(coalesce(p_patch ->> 'instagram_handle', ''), '^@', ''))), '');
    if s is not null and (s !~ '^[a-z0-9._]{1,30}$' or s ~ '\.\.') then raise exception 'LOVOKI_INVALID: instagram_handle'; end if;
    d.instagram_handle := s;
  end if;
  if p_patch ? 'height_cm' then
    if jsonb_typeof(p_patch -> 'height_cm') = 'null' then d.height_cm := null;
    else
      if jsonb_typeof(p_patch -> 'height_cm') <> 'number' or (p_patch ->> 'height_cm')::numeric <> trunc((p_patch ->> 'height_cm')::numeric)
         or (p_patch ->> 'height_cm')::numeric not between 120 and 230 then raise exception 'LOVOKI_INVALID: height_cm'; end if;
      d.height_cm := (p_patch ->> 'height_cm')::smallint;
    end if;
  end if;
  if p_patch ? 'job_title' then d.job_title := nullif(btrim(coalesce(p_patch ->> 'job_title', '')), ''); end if;
  if p_patch ? 'company_or_school' then d.company_or_school := nullif(btrim(coalesce(p_patch ->> 'company_or_school', '')), ''); end if;
  if (d.job_title is not null and (char_length(d.job_title) > 60 or d.job_title ~ '[[:cntrl:]]'))
     or (d.company_or_school is not null and (char_length(d.company_or_school) > 60 or d.company_or_school ~ '[[:cntrl:]]')) then raise exception 'LOVOKI_INVALID: work'; end if;
  if p_patch ? 'education_level' then d.education_level := p_patch ->> 'education_level'; end if;
  if p_patch ? 'languages' then
    v := p_patch -> 'languages';
    if jsonb_typeof(v) = 'null' then d.languages := '{}';
    else
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 10 then raise exception 'LOVOKI_INVALID: languages'; end if;
      select coalesce(array_agg(distinct x), '{}') into d.languages from jsonb_array_elements_text(v) x;
      if exists (select 1 from unnest(d.languages) c where not exists (select 1 from public.languages l where l.code = c)) then raise exception 'LOVOKI_INVALID: languages'; end if;
    end if;
  end if;
  if p_patch ? 'drinking' then d.drinking := p_patch ->> 'drinking'; end if;
  if p_patch ? 'smoking' then d.smoking := p_patch ->> 'smoking'; end if;
  if p_patch ? 'exercise' then d.exercise := p_patch ->> 'exercise'; end if;
  if p_patch ? 'diet' then d.diet := p_patch ->> 'diet'; end if;
  if p_patch ? 'pets' then
    v := p_patch -> 'pets';
    if jsonb_typeof(v) = 'null' then d.pets := '{}';
    else
      if jsonb_typeof(v) <> 'array' then raise exception 'LOVOKI_INVALID: pets'; end if;
      select coalesce(array_agg(distinct x), '{}') into d.pets from jsonb_array_elements_text(v) x;
    end if;
  end if;
  if p_patch ? 'has_kids' then d.has_kids := p_patch ->> 'has_kids'; end if;
  if p_patch ? 'wants_kids' then d.wants_kids := p_patch ->> 'wants_kids'; end if;
  if p_patch ? 'relationship_structure' then d.relationship_structure := p_patch ->> 'relationship_structure'; end if;
  if p_patch ? 'religion' then
    if p_patch ->> 'religion' is null then d.religion := null;
    else
      if (p_patch ->> 'religion_optin') is distinct from 'true' then raise exception 'LOVOKI_INVALID: religion_optin'; end if;
      d.religion := p_patch ->> 'religion';
    end if;
  end if;
  vis := d.visibility || p_visibility;
  if not public._valid_visibility(vis) then raise exception 'LOVOKI_INVALID: visibility'; end if;
  if d.religion is null then vis := vis - 'religion'; end if; -- clearing religion resets its visibility to hidden
  begin
    update public.profile_details set instagram_handle = d.instagram_handle, height_cm = d.height_cm, job_title = d.job_title, company_or_school = d.company_or_school,
      education_level = d.education_level, languages = d.languages, drinking = d.drinking, smoking = d.smoking, exercise = d.exercise, diet = d.diet, pets = d.pets,
      has_kids = d.has_kids, wants_kids = d.wants_kids, relationship_structure = d.relationship_structure, religion = d.religion, visibility = vis where user_id = u;
  exception when check_violation then raise exception 'LOVOKI_INVALID: details';
  end;
end $$;

create or replace function public.save_dating_filters(p_intentions text[], p_interests text[], p_height_min int default null, p_height_max int default null,
                                                      p_drinking text[] default '{}', p_smoking text[] default '{}', p_kids text[] default '{}')
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); i text[] := coalesce(p_interests, '{}');
begin
  perform public._create_account_rows(u);
  if cardinality(i) > 8 or exists (select 1 from unnest(i) s where not exists (select 1 from public.interests x where x.slug = s)) then raise exception 'LOVOKI_INVALID: interests'; end if;
  if not (coalesce(p_intentions, '{}') <@ array['long-term', 'long-term-open', 'short-term-open', 'figuring-out', 'friends-first']::text[]) then raise exception 'LOVOKI_INVALID: intentions'; end if;
  if (p_height_min is not null and p_height_min not between 120 and 230) or (p_height_max is not null and p_height_max not between 120 and 230)
     or (p_height_min is not null and p_height_max is not null and p_height_min > p_height_max) then raise exception 'LOVOKI_INVALID: height'; end if;
  begin
    update public.dating_preferences set filter_intentions = coalesce(p_intentions, '{}'), filter_interests = i, filter_height_min = p_height_min, filter_height_max = p_height_max,
      filter_drinking = coalesce(p_drinking, '{}'), filter_smoking = coalesce(p_smoking, '{}'), filter_kids = coalesce(p_kids, '{}') where user_id = u;
  exception when check_violation then raise exception 'LOVOKI_INVALID: filters';
  end;
end $$;
drop function public.save_dating_filters(text[], text[]);

/* ------------------------------------------- one function decides field visibility */

create function public._field_visibility(owner uuid, k text) returns text language sql stable security definer set search_path = ''
as $$ select coalesce((select d.visibility ->> k from public.profile_details d where d.user_id = owner), public._default_visibility(k)) $$;

-- ctx 'social': the viewer must be able to see the profile (follower rule applies). ctx 'dating': the viewer must be eligible or matched.
create function public._can_see_field(viewer uuid, owner uuid, k text, ctx text) returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare v text; base boolean;
begin
  if viewer is null or owner is null then return false; end if;
  if viewer = owner then return true; end if;
  v := public._field_visibility(owner, coalesce(k, ''));
  if v = 'X' then return false; end if;
  if v = 'M' then return public._active_match(viewer, owner) is not null; end if;
  if ctx = 'dating' then base := public._active_match(viewer, owner) is not null or public._dating_eligible(viewer, owner, false);
  else base := public._active_match(viewer, owner) is not null or public.can_view_content(viewer, owner, 'public'); end if;
  if not base then return false; end if;
  if v = 'P' then return true; end if;
  if v = 'F' then return exists (select 1 from public.follows f where f.follower_id = viewer and f.followee_id = owner and f.status = 'accepted'); end if;
  return false;
end $$;

-- Only fields the viewer may see, and only the ones that are set.
create function public._visible_details(viewer uuid, owner uuid, ctx text) returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select jsonb_strip_nulls(jsonb_build_object(
      'instagram_handle', case when public._can_see_field(viewer, owner, 'instagram', ctx) then d.instagram_handle end,
      'height_cm', case when public._can_see_field(viewer, owner, 'height', ctx) then d.height_cm end,
      'job_title', case when public._can_see_field(viewer, owner, 'work', ctx) then d.job_title end,
      'company_or_school', case when public._can_see_field(viewer, owner, 'work', ctx) then d.company_or_school end,
      'education_level', case when public._can_see_field(viewer, owner, 'education', ctx) then d.education_level end,
      'languages', case when cardinality(d.languages) > 0 and public._can_see_field(viewer, owner, 'languages', ctx) then to_jsonb(d.languages) end,
      'drinking', case when public._can_see_field(viewer, owner, 'lifestyle', ctx) then d.drinking end,
      'smoking', case when public._can_see_field(viewer, owner, 'lifestyle', ctx) then d.smoking end,
      'exercise', case when public._can_see_field(viewer, owner, 'lifestyle', ctx) then d.exercise end,
      'diet', case when public._can_see_field(viewer, owner, 'lifestyle', ctx) then d.diet end,
      'pets', case when cardinality(d.pets) > 0 and public._can_see_field(viewer, owner, 'lifestyle', ctx) then to_jsonb(d.pets) end,
      'has_kids', case when public._can_see_field(viewer, owner, 'kids', ctx) then d.has_kids end,
      'wants_kids', case when public._can_see_field(viewer, owner, 'kids', ctx) then d.wants_kids end,
      'relationship_structure', case when public._can_see_field(viewer, owner, 'structure', ctx) then d.relationship_structure end,
      'religion', case when public._can_see_field(viewer, owner, 'religion', ctx) then d.religion end))
    from public.profile_details d where d.user_id = owner), '{}'::jsonb)
$$;

create function public._avatar_path(owner uuid) returns text language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select ph.storage_path from public.profiles p join public.profile_photos ph on ph.id = p.avatar_photo_id where p.user_id = owner),
    (select ph.storage_path from public.profile_photos ph where ph.user_id = owner and ph.position = 0))
$$;

/* ---------------------------------------------------------------- dating cards */

drop function public.discover_profiles(int, text);
drop function public.dating_profile(uuid);
drop function public.list_matches(int, text);
drop function public._dating_cards(uuid, uuid[]);

create function public._dating_cards(v uuid, ids uuid[])
returns table (
  user_id uuid, display_name text, username text, age int, gender text, gender_custom text, area_label text, distance_bucket text, intention text,
  interests text[], prompts jsonb, photo_paths text[], avatar_path text, avatar_crop jsonb, bio text, pronouns text, details jsonb, is_match boolean
) language sql stable security definer set search_path = ''
as $$
  select p.user_id, p.display_name, p.username::text, public.age_of(pv.date_of_birth),
         case when p.show_gender then p.gender end, case when p.show_gender then p.gender_custom end, p.area_label,
         public._bucket(public._dating_distance(v, p.user_id)), p.intention,
         coalesce((select array_agg(pi.slug order by pi.slug) from public.profile_interests pi where pi.user_id = p.user_id), '{}'),
         coalesce((select jsonb_agg(jsonb_build_object('question', pp.question, 'answer', pp.answer) order by pp.position) from public.profile_prompts pp where pp.user_id = p.user_id), '[]'::jsonb),
         coalesce((select array_agg(ph.storage_path order by ph.position) from public.profile_photos ph where ph.user_id = p.user_id), '{}'),
         public._avatar_path(p.user_id), p.avatar_crop, p.bio,
         case when public._active_match(v, p.user_id) is not null then p.pronouns end,
         public._visible_details(v, p.user_id, 'dating'),
         public._active_match(v, p.user_id) is not null
  from public.profiles p join public.profiles_private pv on pv.user_id = p.user_id
  where p.user_id = any (ids)
$$;

create function public.discover_profiles(p_limit int default 10, p_cursor text default null)
returns table (
  user_id uuid, display_name text, username text, age int, gender text, gender_custom text, area_label text, distance_bucket text, intention text,
  interests text[], prompts jsonb, photo_paths text[], avatar_path text, avatar_crop jsonb, bio text, details jsonb, page_cursor text
) language plpgsql security definer set search_path = ''
as $$
declare
  u uuid := public._require_completed(); day date; seed text; ch text := null; cid uuid := null; ids uuid[];
  fi text[]; fint text[]; fhmin int; fhmax int; fdr text[]; fsm text[]; fkd text[];
begin
  perform public._rate_hit('discover', public._limit_discover_hourly(), 'hour');
  if not exists (select 1 from public.profiles me where me.user_id = u and me.dating_discoverable) then raise exception 'LOVOKI_PAUSED'; end if;
  if not exists (select 1 from public.profiles me where me.user_id = u and me.gender is not null) then raise exception 'LOVOKI_PROFILE_INCOMPLETE: gender'; end if;
  day := public._discover_cursor_day(p_cursor);
  if p_cursor is not null then ch := split_part(p_cursor, '|', 2); cid := split_part(p_cursor, '|', 3)::uuid; end if;
  seed := u::text || ':' || day::text || ':';
  select dp.filter_intentions, dp.filter_interests, dp.filter_height_min, dp.filter_height_max, dp.filter_drinking, dp.filter_smoking, dp.filter_kids
    into fint, fi, fhmin, fhmax, fdr, fsm, fkd from public.dating_preferences dp where dp.user_id = u;

  -- Soft filters only narrow MY queue. A filter on an optional field matches only people who chose to show that field to me, so a filter can never leak a hidden answer.
  select array_agg(c.id order by c.h, c.id) into ids from (
    select t.user_id as id, md5(seed || t.user_id::text) as h
    from public.profiles t
    left join public.profile_details td on td.user_id = t.user_id
    where t.user_id <> u
      and public._dating_eligible(u, t.user_id, false)
      and not exists (select 1 from public.dating_actions a where a.actor_id = u and a.target_id = t.user_id
                      and (a.action = 'like' or (a.action = 'pass' and a.created_at > now() - make_interval(days => public._pass_days()))))
      and (cardinality(fint) = 0 or t.intention = any (fint))
      and (cardinality(fi) = 0 or exists (select 1 from public.profile_interests pi where pi.user_id = t.user_id and pi.slug = any (fi)))
      and ((fhmin is null and fhmax is null) or (public._can_see_field(u, t.user_id, 'height', 'dating') and td.height_cm is not null
           and (fhmin is null or td.height_cm >= fhmin) and (fhmax is null or td.height_cm <= fhmax)))
      and (cardinality(fdr) = 0 or (public._can_see_field(u, t.user_id, 'lifestyle', 'dating') and td.drinking = any (fdr)))
      and (cardinality(fsm) = 0 or (public._can_see_field(u, t.user_id, 'lifestyle', 'dating') and td.smoking = any (fsm)))
      and (cardinality(fkd) = 0 or (public._can_see_field(u, t.user_id, 'kids', 'dating') and td.wants_kids = any (fkd)))
      and (ch is null or (md5(seed || t.user_id::text), t.user_id) > (ch, cid))
    order by md5(seed || t.user_id::text), t.user_id
    limit public._page_size(p_limit) + 1) c;

  return query
    select c.user_id, c.display_name, c.username, c.age, c.gender, c.gender_custom, c.area_label, c.distance_bucket, c.intention, c.interests, c.prompts, c.photo_paths,
           c.avatar_path, c.avatar_crop, c.bio, c.details, day::text || '|' || md5(seed || c.user_id::text) || '|' || c.user_id::text
    from public._dating_cards(u, coalesce(ids, '{}')) c
    join unnest(coalesce(ids, '{}')) with ordinality o(id, ord) on o.id = c.user_id
    order by o.ord;
end $$;

create function public.dating_profile(p_user uuid)
returns table (
  user_id uuid, display_name text, username text, age int, gender text, gender_custom text, area_label text, distance_bucket text, intention text,
  interests text[], prompts jsonb, photo_paths text[], avatar_path text, avatar_crop jsonb, bio text, pronouns text, details jsonb, is_match boolean, match_id uuid, matched_at timestamptz
) language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); mid uuid;
begin
  mid := public._active_match(u, p_user);
  if mid is null and not public._dating_eligible(u, p_user, false) then return; end if;
  return query select c.user_id, c.display_name, c.username, c.age, c.gender, c.gender_custom, c.area_label, c.distance_bucket, c.intention, c.interests, c.prompts, c.photo_paths,
                      c.avatar_path, c.avatar_crop, c.bio, c.pronouns, c.details, c.is_match, mid, (select m.created_at from public.matches m where m.id = mid)
               from public._dating_cards(u, array[p_user]) c;
end $$;

create function public.list_matches(p_limit int default 20, p_cursor text default null)
returns table (
  match_id uuid, matched_at timestamptz, user_id uuid, display_name text, username text, age int, gender text, gender_custom text, area_label text, distance_bucket text,
  intention text, interests text[], prompts jsonb, photo_paths text[], avatar_path text, avatar_crop jsonb, bio text, pronouns text, details jsonb, page_cursor text
) language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  return query
    select m.id, m.created_at, c.user_id, c.display_name, c.username, c.age, c.gender, c.gender_custom, c.area_label, c.distance_bucket, c.intention, c.interests, c.prompts,
           c.photo_paths, c.avatar_path, c.avatar_crop, c.bio, c.pronouns, c.details, public._make_cursor(m.created_at, m.id)
    from public.matches m
    cross join lateral (select case when m.user_a = u then m.user_b else m.user_a end as other) o
    join lateral public._dating_cards(u, array[o.other]) c on true
    where m.unmatched_at is null and (m.user_a = u or m.user_b = u)
      and (p_cursor is null or (m.created_at, m.id) < (public._cursor_ts(p_cursor), public._cursor_id(p_cursor)))
      and not public._blocked_between(u, o.other)
    order by m.created_at desc, m.id desc
    limit public._page_size(p_limit) + 1;
end $$;

/* ------------------------------------------------------------ social surfaces */

drop function public.social_profile(uuid);
create function public.social_profile(p_user uuid)
returns table (
  user_id uuid, username text, display_name text, pronouns text, bio text, area_label text, age int, gender text, gender_custom text, photo_path text, avatar_crop jsonb,
  interests text[], prompts jsonb, details jsonb, restricted boolean, is_self boolean, follow_status text, follows_me_status text,
  follower_count int, following_count int, post_count int
) language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); full_view boolean;
begin
  if p_user is null or public._blocked_between(u, p_user) or not public._is_completed(p_user) then return; end if;
  full_view := public.can_view_content(u, p_user, 'public');
  return query
    select pr.user_id, pr.username::text, pr.display_name,
           case when full_view then pr.pronouns end, case when full_view then pr.bio end, case when full_view then pr.area_label end,
           case when full_view then public.age_of(pv.date_of_birth) end,
           case when full_view and pr.show_gender then pr.gender end, case when full_view and pr.show_gender then pr.gender_custom end,
           case when full_view then public._avatar_path(pr.user_id) end, case when full_view then pr.avatar_crop end,
           case when full_view then coalesce((select array_agg(pi.slug order by pi.slug) from public.profile_interests pi where pi.user_id = pr.user_id), '{}') end,
           case when full_view then coalesce((select jsonb_agg(jsonb_build_object('question', pp.question, 'answer', pp.answer) order by pp.position) from public.profile_prompts pp where pp.user_id = pr.user_id), '[]'::jsonb) end,
           case when full_view then public._visible_details(u, pr.user_id, 'social') else '{}'::jsonb end,
           not full_view, pr.user_id = u,
           (select f.status from public.follows f where f.follower_id = u and f.followee_id = pr.user_id),
           (select f.status from public.follows f where f.follower_id = pr.user_id and f.followee_id = u),
           case when full_view and (pr.show_follower_counts or pr.user_id = u) then (select count(*)::int from public.follows f where f.followee_id = pr.user_id and f.status = 'accepted') end,
           case when full_view and (pr.show_follower_counts or pr.user_id = u) then (select count(*)::int from public.follows f where f.follower_id = pr.user_id and f.status = 'accepted') end,
           case when full_view then (select count(*)::int from public.posts po where po.author_id = pr.user_id and public.can_view_content(u, po.author_id, po.audience)) end
    from public.profiles pr join public.profiles_private pv on pv.user_id = pr.user_id
    where pr.user_id = p_user;
end $$;

-- Posts: avatars follow the chosen avatar photo, rows say whether the viewer may comment, and a single post can be fetched ('post' mode).
drop function public.feed_page(text, int, text);
drop function public.profile_posts_page(uuid, int, text);
drop function public.saved_posts_page(int, text);
drop function public._post_rows(uuid, text, uuid, int, text);

create function public._comments_allowed(p_viewer uuid, p_author uuid) returns boolean language sql stable security definer set search_path = ''
as $$
  select case when p_viewer = p_author then true else (
    select case pr.allow_comments when 'everyone' then true when 'followers' then exists (select 1 from public.follows f where f.follower_id = p_viewer and f.followee_id = p_author and f.status = 'accepted') else false end
    from public.profiles pr where pr.user_id = p_author) end
$$;

create function public._post_rows(p_viewer uuid, p_mode text, p_author uuid, p_limit int, p_cursor text)
returns table (
  post_id uuid, author_id uuid, author_name text, author_photo_path text, caption text, audience text,
  created_at timestamptz, media_path text, media_type text, like_count int, comment_count int,
  liked_by_me boolean, saved_by_me boolean, is_mine boolean, page_cursor text, comments_allowed boolean
) language sql stable security definer set search_path = ''
as $$
  select po.id, po.author_id, pr.display_name,
         case when public.can_view_content(p_viewer, po.author_id, 'public') then public._avatar_path(po.author_id) end,
         po.caption, po.audience, po.created_at, m.storage_path, m.content_type,
         public._like_count(p_viewer, po.id), public._comment_count(p_viewer, po.id),
         exists (select 1 from public.post_likes l where l.post_id = po.id and l.user_id = p_viewer),
         exists (select 1 from public.post_saves s where s.post_id = po.id and s.user_id = p_viewer),
         po.author_id = p_viewer, public._make_cursor(po.created_at, po.id),
         public._comments_allowed(p_viewer, po.author_id)
  from public.posts po
  join public.profiles pr on pr.user_id = po.author_id
  left join lateral (select pm.storage_path, pm.content_type from public.post_media pm where pm.post_id = po.id and pm.position = 0) m on true
  where (p_cursor is null or (po.created_at, po.id) < (public._cursor_ts(p_cursor), public._cursor_id(p_cursor)))
    and public.can_view_content(p_viewer, po.author_id, po.audience)
    and case p_mode
      when 'explore' then po.audience = 'public' and pr.social_visibility = 'public'
      when 'following' then po.author_id = p_viewer
        or exists (select 1 from public.follows f where f.follower_id = p_viewer and f.followee_id = po.author_id and f.status = 'accepted')
      when 'author' then po.author_id = p_author
      when 'saved' then exists (select 1 from public.post_saves s where s.user_id = p_viewer and s.post_id = po.id)
      when 'post' then po.id = p_author
      else false end
  order by po.created_at desc, po.id desc
  limit public._page_size(p_limit) + 1
$$;

create function public.feed_page(p_feed text, p_limit int default 15, p_cursor text default null)
returns table (
  post_id uuid, author_id uuid, author_name text, author_photo_path text, caption text, audience text,
  created_at timestamptz, media_path text, media_type text, like_count int, comment_count int,
  liked_by_me boolean, saved_by_me boolean, is_mine boolean, page_cursor text, comments_allowed boolean
) language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  if p_feed not in ('explore', 'following') then raise exception 'LOVOKI_INVALID: feed'; end if;
  return query select * from public._post_rows(u, p_feed, null, p_limit, p_cursor);
end $$;

create function public.profile_posts_page(p_author uuid, p_limit int default 15, p_cursor text default null)
returns table (
  post_id uuid, author_id uuid, author_name text, author_photo_path text, caption text, audience text,
  created_at timestamptz, media_path text, media_type text, like_count int, comment_count int,
  liked_by_me boolean, saved_by_me boolean, is_mine boolean, page_cursor text, comments_allowed boolean
) language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  return query select * from public._post_rows(u, 'author', p_author, p_limit, p_cursor);
end $$;

create function public.saved_posts_page(p_limit int default 15, p_cursor text default null)
returns table (
  post_id uuid, author_id uuid, author_name text, author_photo_path text, caption text, audience text,
  created_at timestamptz, media_path text, media_type text, like_count int, comment_count int,
  liked_by_me boolean, saved_by_me boolean, is_mine boolean, page_cursor text, comments_allowed boolean
) language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  return query select * from public._post_rows(u, 'saved', null, p_limit, p_cursor);
end $$;

create function public.post_page(p_post uuid)
returns table (
  post_id uuid, author_id uuid, author_name text, author_photo_path text, caption text, audience text,
  created_at timestamptz, media_path text, media_type text, like_count int, comment_count int,
  liked_by_me boolean, saved_by_me boolean, is_mine boolean, page_cursor text, comments_allowed boolean
) language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  return query select * from public._post_rows(u, 'post', p_post, 1, null) limit 1;
end $$;

create or replace function public.add_comment(p_post uuid, p_body text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); a uuid; b text := btrim(coalesce(p_body, '')); cid uuid;
begin
  if char_length(b) not between 1 and 300 then raise exception 'LOVOKI_INVALID: comment'; end if;
  a := public._visible_post_author(u, p_post);
  if not public._comments_allowed(u, a) then raise exception 'LOVOKI_COMMENTS_OFF'; end if;
  insert into public.post_comments (post_id, author_id, body) values (p_post, u, b) returning id into cid;
  perform public._notify(a, u, 'comment', p_post, cid);
  return cid;
end $$;

/* ----------------------------------------------------------- completion */

create or replace function public.complete_onboarding()
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
  if p.username is null then missing := array_append(missing, 'username'); end if;
  if dob is null or not public.is_adult_on(dob, current_date) then missing := array_append(missing, 'dateOfBirth'); end if;
  if p.gender is null then missing := array_append(missing, 'gender'); end if;
  if p.intention is null then missing := array_append(missing, 'intention'); end if;
  if coalesce(cardinality(d.interested_in), 0) = 0 then missing := array_append(missing, 'interestedIn'); end if;
  if photos < 1 then missing := array_append(missing, 'photos'); end if;
  if not exists (select 1 from public.profile_places where user_id = u) then missing := array_append(missing, 'place'); end if;
  if not exists (select 1 from public.consents where user_id = u) then missing := array_append(missing, 'consent'); end if;
  if cardinality(missing) > 0 then raise exception 'LOVOKI_ONBOARDING_INCOMPLETE:%', array_to_string(missing, ','); end if;
  update public.onboarding_state set completed_at = coalesce(completed_at, now()), current_step = 'review'
    where user_id = u returning completed_at into done;
  return done;
end $$;

/* ------------------------------------------------------- function grants */

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
    '_default_visibility', '_valid_visibility', '_reserved_handle', '_handle_status', '_field_visibility', '_can_see_field', '_visible_details', '_avatar_path',
    '_comments_allowed', '_dating_cards', '_post_rows', 'handle_new_user', '_create_account_rows',
    'record_consent', 'set_marketing_consent', 'check_username', 'set_username', 'resolve_username', 'search_places', 'nearest_places', 'save_place_id', 'my_place',
    'save_dating_profile', 'save_avatar', 'save_social_settings', 'save_profile_details', 'save_dating_filters', 'discover_profiles', 'dating_profile', 'list_matches',
    'social_profile', 'feed_page', 'profile_posts_page', 'saved_posts_page', 'post_page', 'add_comment', 'complete_onboarding'])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
    'record_consent', 'set_marketing_consent', 'check_username', 'set_username', 'resolve_username', 'search_places', 'nearest_places', 'save_place_id', 'my_place',
    'save_dating_profile', 'save_avatar', 'save_social_settings', 'save_profile_details', 'save_dating_filters', 'discover_profiles', 'dating_profile', 'list_matches',
    'social_profile', 'feed_page', 'profile_posts_page', 'saved_posts_page', 'post_page', 'add_comment', 'complete_onboarding'])
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

commit;
