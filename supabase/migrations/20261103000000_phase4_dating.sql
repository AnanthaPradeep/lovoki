-- LOVOKI Phase 4: dating (discovery, likes and passes, mutual matches, unmatch, approximate distance).
-- Includes the minimal "Phase 3.5" this phase needs: gender, a rounded place, distance/gender display flags, soft filters.
-- Apply ONLY to a local or explicitly identified development Supabase project (see docs/PHASE_4_SETUP.md).
--
-- Security model (same as Phases 2 and 3)
--   * Every new table has RLS on and NO client privilege except an own-row read of profile_places.
--     dating_actions, matches, dating_exclusions and dating_rate have no client read path at all.
--     Likes are private: nothing returns who liked whom, and no notification says "someone liked you".
--   * All writes and reads go through SECURITY DEFINER functions using auth.uid().
--   * ONE eligibility function (_dating_eligible) decides who may see/like whom, and it plugs into the single shared
--     visibility function: can_view_content(viewer, author, 'dating'). The photo storage policy calls it.
--
-- Named limits (change them here, in one place each)
--   _limit_daily_likes()      50 new likes per rolling 24 hours per person
--   _limit_discover_hourly()  120 discover_profiles calls per clock hour per person
--   _pass_days()              a pass hides someone for 90 days
--
-- Settled behaviours
--   * Pause (dating_discoverable = false): the person vanishes from everyone's discovery at once. Existing matches stay.
--     A paused person cannot like or discover, and cannot be newly matched. Likes others send them are stored but inert;
--     when they resume, mutual pairs become matches then (and both are told). Likes they sent earlier are inert the same way.
--   * Unmatch: permanent exclusion in both directions. A social block also ends any match and adds the same exclusion.
--   * Distance: great-circle (haversine) on the owner-rounded place (2 decimals, about 1 km). Clients only ever receive a bucket
--     (<5, <10, <25, <50, <100, 100+ km), never a number and never coordinates. A person who hides distance, or anyone without a
--     place, is simply not subject to distance filtering. The viewer's max distance is rounded UP to a bucket edge so a threshold
--     can never be probed at a finer grain than the buckets.
--   * Hard compatibility (gender both ways, age range both ways, viewer's max distance) applies to liking and discovery.
--     Soft filters (intentions, interests) apply only to the viewer's own queue.
--   * "M-visibility" (matched people only): pronouns and the date of the match. Everything else on the card is the same before and after.

begin;

/* ------------------------------------------------------------ profile additions */

alter table public.profiles
  add column gender text check (gender in ('woman', 'man', 'non-binary')),
  add column show_gender boolean not null default true,
  add column show_distance boolean not null default true;

alter table public.dating_preferences
  add column filter_intentions text[] not null default '{}'
    check (filter_intentions <@ array['long-term', 'long-term-open', 'short-term-open', 'figuring-out', 'friends-first']::text[]),
  add column filter_interests text[] not null default '{}' check (cardinality(filter_interests) <= 8);

create table public.profile_places (
  user_id uuid primary key references auth.users (id) on delete cascade,
  lat numeric(5, 2) not null check (lat between -90 and 90),
  lng numeric(5, 2) not null check (lng between -180 and 180),
  updated_at timestamptz not null default now()
);

/* ------------------------------------------------------------------- tables */

create table public.dating_actions (
  actor_id uuid not null references auth.users (id) on delete cascade,
  target_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (action in ('like', 'pass')),
  created_at timestamptz not null default now(),
  primary key (actor_id, target_id),
  check (actor_id <> target_id)
);
create index dating_actions_target_idx on public.dating_actions (target_id, action);
create index dating_actions_recent_idx on public.dating_actions (actor_id, created_at desc);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  unmatched_at timestamptz,
  unmatched_by uuid references auth.users (id) on delete set null,
  unique (user_a, user_b),
  check (user_a < user_b),
  check ((unmatched_at is null) = (unmatched_by is null) or unmatched_by is null)
);
create index matches_a_idx on public.matches (user_a, created_at desc, id desc) where unmatched_at is null;
create index matches_b_idx on public.matches (user_b, created_at desc, id desc) where unmatched_at is null;

create table public.dating_exclusions (
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('unmatch', 'block')),
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

create table public.dating_rate (
  actor_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  window_start timestamptz not null,
  n int not null default 0,
  primary key (actor_id, kind, window_start)
);

do $$
declare t text;
begin
  foreach t in array array['profile_places', 'dating_actions', 'matches', 'dating_exclusions', 'dating_rate'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;
create policy profile_places_select_own on public.profile_places for select to authenticated using (user_id = (select auth.uid()));
grant select on public.profile_places to authenticated;

-- A match is the only dating event that is announced.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like', 'comment', 'follow', 'follow_request', 'follow_accepted', 'match'));
create unique index notifications_match_uniq on public.notifications (recipient_id, actor_id) where type = 'match';

-- The Phase 2 view listed every discoverable profile (with age) to any signed-in user. It bypasses eligibility and would
-- reveal who is discoverable, so it is removed. Discovery now only goes through discover_profiles().
drop view public.discoverable_profiles;

/* -------------------------------------------------------------- named limits */

create function public._limit_daily_likes() returns int language sql immutable set search_path = '' as $$ select 50 $$;
create function public._limit_discover_hourly() returns int language sql immutable set search_path = '' as $$ select 120 $$;
create function public._pass_days() returns int language sql immutable set search_path = '' as $$ select 90 $$;

/* ------------------------------------------------------------------ geometry */

-- Great-circle distance in km. numeric inputs are the owner-rounded place, so this never sees exact positions.
create function public._haversine_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns double precision language sql immutable set search_path = ''
as $$
  select 6371.0 * 2 * asin(least(1.0, sqrt(
    power(sin(radians((lat2 - lat1)::double precision) / 2), 2) +
    cos(radians(lat1::double precision)) * cos(radians(lat2::double precision)) * power(sin(radians((lng2 - lng1)::double precision) / 2), 2))))
$$;

create function public._bucket(km double precision)
returns text language sql immutable set search_path = ''
as $$ select case when km is null then null when km < 5 then '<5' when km < 10 then '<10' when km < 25 then '<25'
                  when km < 50 then '<50' when km < 100 then '<100' else '100+' end $$;

-- Rounds a max distance UP to a bucket edge (null = no limit), so the threshold is never finer than the buckets.
create function public._effective_max_km(m int)
returns double precision language sql immutable set search_path = ''
as $$ select case when m is null then null when m <= 5 then 5 when m <= 10 then 10 when m <= 25 then 25
                  when m <= 50 then 50 when m <= 100 then 100 else null end::double precision $$;

/* ---------------------------------------------------------------- eligibility */

create function public._gender_wanted(g text, wanted text[])
returns boolean language sql immutable set search_path = ''
as $$ select g is not null and (case g when 'woman' then 'women' when 'man' then 'men' else 'non-binary' end) = any (wanted) $$;

create function public._active_match(a uuid, b uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select id from public.matches where user_a = least(a, b) and user_b = greatest(a, b) and unmatched_at is null $$;

-- Distance for the VIEWER's use. Null when either person has no place or the target hides distance.
create function public._dating_distance(v uuid, t uuid)
returns double precision language sql stable security definer set search_path = ''
as $$
  select public._haversine_km(pv.lat, pv.lng, pt.lat, pt.lng)
  from public.profile_places pv, public.profile_places pt, public.profiles tp
  where pv.user_id = v and pt.user_id = t and tp.user_id = t and tp.show_distance
$$;

-- THE dating eligibility rule: may viewer v see and like target t? p_ignore_pause only relaxes the TARGET's pause (used to store inert likes).
create function public._dating_eligible(v uuid, t uuid, p_ignore_pause boolean default false)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  vg text; tg text; vdis boolean; tdis boolean; vdob date; tdob date; vi text[]; ti text[];
  vmin int; vmax int; tmin int; tmax int; vmaxkm int; vdone timestamptz; tdone timestamptz;
  va int; ta int; dist double precision; lim double precision;
begin
  if v is null or t is null or v = t then return false; end if;
  if public._blocked_between(v, t) then return false; end if;
  if exists (select 1 from public.dating_exclusions where user_a = least(v, t) and user_b = greatest(v, t)) then return false; end if;
  if public._active_match(v, t) is not null then return false; end if;

  select p.gender, p.dating_discoverable, pv.date_of_birth, d.interested_in, d.age_min, d.age_max, d.max_distance_km, o.completed_at
    into vg, vdis, vdob, vi, vmin, vmax, vmaxkm, vdone
    from public.profiles p join public.profiles_private pv on pv.user_id = p.user_id
    join public.dating_preferences d on d.user_id = p.user_id join public.onboarding_state o on o.user_id = p.user_id where p.user_id = v;
  select p.gender, p.dating_discoverable, pv.date_of_birth, d.interested_in, d.age_min, d.age_max, o.completed_at
    into tg, tdis, tdob, ti, tmin, tmax, tdone
    from public.profiles p join public.profiles_private pv on pv.user_id = p.user_id
    join public.dating_preferences d on d.user_id = p.user_id join public.onboarding_state o on o.user_id = p.user_id where p.user_id = t;
  if vdone is null or tdone is null then return false; end if;
  -- Adults only, checked here again on top of the date-of-birth trigger.
  if vdob is null or tdob is null or not public.is_adult_on(vdob, current_date) or not public.is_adult_on(tdob, current_date) then return false; end if;
  if not coalesce(vdis, false) then return false; end if;
  if not coalesce(tdis, false) and not p_ignore_pause then return false; end if;
  if vg is null or tg is null then return false; end if;
  if not (public._gender_wanted(tg, vi) and public._gender_wanted(vg, ti)) then return false; end if;
  va := public.age_of(vdob); ta := public.age_of(tdob);
  if not (ta between vmin and vmax and va between tmin and tmax) then return false; end if;
  lim := public._effective_max_km(vmaxkm);
  if lim is not null then
    dist := public._dating_distance(v, t);
    if dist is not null and dist >= lim then return false; end if;
  end if;
  return true;
end $$;

/* ------------------------------------- extend the single shared visibility function */

create or replace function public.can_view_content(p_viewer uuid, p_author uuid, p_audience text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare vis text; effective text;
begin
  if p_viewer is null or p_author is null then return false; end if;
  if p_viewer = p_author then return true; end if;
  -- Dating context: an eligible stranger or a current match. Honours blocks, pause, exclusions and compatibility.
  if p_audience = 'dating' then
    return public._active_match(p_viewer, p_author) is not null or public._dating_eligible(p_viewer, p_author, false);
  end if;
  if p_audience not in ('public', 'followers') then return false; end if;
  if public._blocked_between(p_viewer, p_author) then return false; end if;
  if not (public._is_completed(p_viewer) and public._is_completed(p_author)) then return false; end if;
  select social_visibility into vis from public.profiles where user_id = p_author;
  if vis is null then return false; end if;
  effective := case when p_audience = 'followers' or vis = 'followers' then 'followers' else 'public' end;
  if effective = 'public' then return true; end if;
  return exists (select 1 from public.follows f
    where f.follower_id = p_viewer and f.followee_id = p_author and f.status = 'accepted');
end $$;

-- Profile photos: social rule first, then the dating audience (replaces the Phase 2 "discoverable" shortcut).
create or replace function public.can_view_photos_of(p_owner text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := auth.uid(); o uuid;
begin
  if u is null or p_owner !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  o := p_owner::uuid;
  return public.can_view_content(u, o, 'public') or public.can_view_content(u, o, 'dating');
end $$;

/* ---------------------------------------------------------- rate limiting */

create function public._rate_hit(p_kind text, p_limit int, p_unit text)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); w timestamptz := date_trunc(p_unit, now()); c int;
begin
  insert into public.dating_rate (actor_id, kind, window_start, n) values (u, p_kind, w, 1)
    on conflict (actor_id, kind, window_start) do update set n = public.dating_rate.n + 1 returning n into c;
  if c > p_limit then raise exception 'LOVOKI_RATE_LIMITED'; end if;
  delete from public.dating_rate where actor_id = u and window_start < now() - interval '2 days';
end $$;

/* --------------------------------------------------------------- own profile */

create function public.save_dating_profile(p_gender text, p_show_gender boolean, p_show_distance boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  perform public._create_account_rows(u);
  if p_gender is null or p_gender not in ('woman', 'man', 'non-binary') then raise exception 'LOVOKI_INVALID: gender'; end if;
  update public.profiles set gender = p_gender, show_gender = coalesce(p_show_gender, true), show_distance = coalesce(p_show_distance, true) where user_id = u;
end $$;

-- The place is rounded here, whatever the client sent: 2 decimals is about 1 km. The label also becomes the public area label.
create function public.save_place(p_label text, p_lat numeric, p_lng numeric)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); l text := btrim(coalesce(p_label, ''));
begin
  perform public._create_account_rows(u);
  if char_length(l) not between 1 and 80 or l ~ '\d{1,3}\.\d{3,}' then raise exception 'LOVOKI_INVALID: label'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'LOVOKI_INVALID: place'; end if;
  insert into public.profile_places (user_id, lat, lng) values (u, round(p_lat, 2), round(p_lng, 2))
    on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();
  update public.profiles set area_label = l where user_id = u;
end $$;

create function public.clear_place()
returns void language plpgsql security definer set search_path = ''
as $$ begin delete from public.profile_places where user_id = public._require_uid(); end $$;

create function public.save_dating_filters(p_intentions text[], p_interests text[])
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); i text[] := coalesce(p_interests, '{}');
begin
  perform public._create_account_rows(u);
  if cardinality(i) > 8 or exists (select 1 from unnest(i) s where not exists (select 1 from public.interests x where x.slug = s)) then
    raise exception 'LOVOKI_INVALID: interests';
  end if;
  if not (coalesce(p_intentions, '{}') <@ array['long-term', 'long-term-open', 'short-term-open', 'figuring-out', 'friends-first']::text[]) then
    raise exception 'LOVOKI_INVALID: intentions';
  end if;
  update public.dating_preferences set filter_intentions = coalesce(p_intentions, '{}'), filter_interests = i where user_id = u;
end $$;

create function public.dating_status()
returns table (paused boolean, has_gender boolean, has_place boolean, likes_left int, daily_cap int)
language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  return query select not p.dating_discoverable, p.gender is not null, exists (select 1 from public.profile_places x where x.user_id = u),
    greatest(0, public._limit_daily_likes() - (select count(*)::int from public.dating_actions a where a.actor_id = u and a.action = 'like' and a.created_at > now() - interval '24 hours')),
    public._limit_daily_likes()
    from public.profiles p where p.user_id = u;
end $$;

/* ---------------------------------------------------------------- matching */

-- Creates the match for a mutual, currently eligible pair. Returns the active match id or null. Callers must hold the pair lock.
create function public._try_match(a uuid, b uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare mid uuid; n int;
begin
  mid := public._active_match(a, b);
  if mid is not null then return mid; end if;
  if not (exists (select 1 from public.dating_actions where actor_id = a and target_id = b and action = 'like')
      and exists (select 1 from public.dating_actions where actor_id = b and target_id = a and action = 'like')) then return null; end if;
  if not (public._dating_eligible(a, b, false) and public._dating_eligible(b, a, false)) then return null; end if;
  insert into public.matches (user_a, user_b) values (least(a, b), greatest(a, b)) on conflict (user_a, user_b) do nothing returning id into mid;
  get diagnostics n = row_count;
  if n > 0 then
    perform public._notify(a, b, 'match'); perform public._notify(b, a, 'match');
  else
    mid := public._active_match(a, b);
  end if;
  return mid;
end $$;

create function public.like_profile(p_target uuid)
returns table (matched boolean, match_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); mid uuid; liked boolean; cnt int;
begin
  if p_target is null or p_target = u then raise exception 'LOVOKI_INVALID: target'; end if;
  if not exists (select 1 from public.profiles where user_id = u and dating_discoverable) then raise exception 'LOVOKI_PAUSED'; end if;
  if not exists (select 1 from public.profiles where user_id = u and gender is not null) then raise exception 'LOVOKI_PROFILE_INCOMPLETE: gender'; end if;
  -- Serialize both directions of a pair: two parallel mutual likes then run one after the other and the second sees the first.
  perform pg_advisory_xact_lock(hashtextextended('lovoki:pair:' || least(u, p_target)::text || greatest(u, p_target)::text, 0));
  mid := public._active_match(u, p_target);
  if mid is not null then return query select true, mid; return; end if;
  liked := exists (select 1 from public.dating_actions where actor_id = u and target_id = p_target and action = 'like');
  if not liked then
    select count(*)::int into cnt from public.dating_actions where actor_id = u and action = 'like' and created_at > now() - interval '24 hours';
    if cnt >= public._limit_daily_likes() then raise exception 'LOVOKI_DAILY_LIMIT'; end if;
  end if;
  -- Same neutral answer whether or not the target exists, is compatible, or is hidden.
  if not public._dating_eligible(u, p_target, true) then return query select false, null::uuid; return; end if;
  insert into public.dating_actions (actor_id, target_id, action) values (u, p_target, 'like')
    on conflict (actor_id, target_id) do update set action = 'like', created_at = now() where public.dating_actions.action = 'pass';
  mid := public._try_match(u, p_target);
  return query select mid is not null, mid;
end $$;

create function public.pass_profile(p_target uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  if p_target is null or p_target = u then raise exception 'LOVOKI_INVALID: target'; end if;
  -- Nothing is sent to anyone. An existing like is never downgraded by a pass.
  insert into public.dating_actions (actor_id, target_id, action) select u, p_target, 'pass' where exists (select 1 from auth.users where id = p_target)
    on conflict (actor_id, target_id) do update set created_at = now() where public.dating_actions.action = 'pass';
end $$;

create function public.unmatch(p_match uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); m public.matches;
begin
  select * into m from public.matches where id = p_match and unmatched_at is null and (user_a = u or user_b = u);
  if m.id is null then raise exception 'LOVOKI_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lovoki:pair:' || m.user_a::text || m.user_b::text, 0));
  update public.matches set unmatched_at = now(), unmatched_by = u where id = p_match;
  insert into public.dating_exclusions (user_a, user_b, reason) values (m.user_a, m.user_b, 'unmatch') on conflict do nothing;
  delete from public.notifications where type = 'match' and ((recipient_id = m.user_a and actor_id = m.user_b) or (recipient_id = m.user_b and actor_id = m.user_a));
end $$;

-- Resuming makes inert likes live: mutual pairs become matches now, and both people are told.
create function public.on_dating_resume()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  if new.dating_discoverable and not old.dating_discoverable then
    for r in select actor_id from public.dating_actions where target_id = new.user_id and action = 'like' loop
      perform pg_advisory_xact_lock(hashtextextended('lovoki:pair:' || least(new.user_id, r.actor_id)::text || greatest(new.user_id, r.actor_id)::text, 0));
      perform public._try_match(new.user_id, r.actor_id);
    end loop;
  end if;
  return new;
end $$;
create trigger profiles_dating_resume after update of dating_discoverable on public.profiles
  for each row execute function public.on_dating_resume();

-- A social block ends any match and excludes the pair for good (same as unmatch).
create or replace function public.block_user(p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  if p_user is null or p_user = u then raise exception 'LOVOKI_INVALID: self_block'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'LOVOKI_NOT_FOUND'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (u, p_user) on conflict do nothing;
  delete from public.follows where (follower_id = u and followee_id = p_user) or (follower_id = p_user and followee_id = u);
  delete from public.notifications where (recipient_id = u and actor_id = p_user) or (recipient_id = p_user and actor_id = u);
  update public.matches set unmatched_at = now(), unmatched_by = u where user_a = least(u, p_user) and user_b = greatest(u, p_user) and unmatched_at is null;
  insert into public.dating_exclusions (user_a, user_b, reason) values (least(u, p_user), greatest(u, p_user), 'block') on conflict do nothing;
end $$;

/* ------------------------------------------------------------------- cards */

-- The ONLY shape in which another person's dating profile leaves the database. Never: coordinates, date of birth,
-- discoverability, or whether they liked you. Matched people additionally get pronouns (M-visibility).
create function public._dating_cards(v uuid, ids uuid[])
returns table (
  user_id uuid, display_name text, age int, gender text, area_label text, distance_bucket text, intention text,
  interests text[], prompts jsonb, photo_paths text[], bio text, pronouns text, is_match boolean
) language sql stable security definer set search_path = ''
as $$
  select p.user_id, p.display_name, public.age_of(pv.date_of_birth),
         case when p.show_gender then p.gender end, p.area_label,
         public._bucket(public._dating_distance(v, p.user_id)), p.intention,
         coalesce((select array_agg(pi.slug order by pi.slug) from public.profile_interests pi where pi.user_id = p.user_id), '{}'),
         coalesce((select jsonb_agg(jsonb_build_object('question', pp.question, 'answer', pp.answer) order by pp.position) from public.profile_prompts pp where pp.user_id = p.user_id), '[]'::jsonb),
         coalesce((select array_agg(ph.storage_path order by ph.position) from public.profile_photos ph where ph.user_id = p.user_id), '{}'),
         p.bio,
         case when public._active_match(v, p.user_id) is not null then p.pronouns end,
         public._active_match(v, p.user_id) is not null
  from public.profiles p join public.profiles_private pv on pv.user_id = p.user_id
  where p.user_id = any (ids)
$$;

create function public._discover_cursor_day(p_cursor text) returns date language plpgsql stable set search_path = ''
as $$
declare d date;
begin
  if p_cursor is null then return (now() at time zone 'utc')::date; end if;
  if p_cursor !~ '^\d{4}-\d{2}-\d{2}\|[0-9a-f]{32}\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'LOVOKI_INVALID_CURSOR'; end if;
  begin d := split_part(p_cursor, '|', 1)::date; exception when others then raise exception 'LOVOKI_INVALID_CURSOR'; end;
  -- A session may straddle midnight UTC, but an arbitrary day cannot be forced.
  if d < (now() at time zone 'utc')::date - 1 or d > (now() at time zone 'utc')::date then raise exception 'LOVOKI_INVALID_CURSOR'; end if;
  return d;
end $$;

-- Daily-seeded, per-viewer shuffle. Order is md5(viewer:day:candidate) then id: no engagement ranking, no boosts.
-- Keyset on (hash, id) keeps pages stable while people are liked, passed, paused or added.
create function public.discover_profiles(p_limit int default 10, p_cursor text default null)
returns table (
  user_id uuid, display_name text, age int, gender text, area_label text, distance_bucket text, intention text,
  interests text[], prompts jsonb, photo_paths text[], bio text, page_cursor text
) language plpgsql security definer set search_path = ''
as $$
declare
  u uuid := public._require_completed(); day date; seed text; ch text := null; cid uuid := null; ids uuid[]; fi text[]; fint text[];
begin
  perform public._rate_hit('discover', public._limit_discover_hourly(), 'hour');
  if not exists (select 1 from public.profiles me where me.user_id = u and me.dating_discoverable) then raise exception 'LOVOKI_PAUSED'; end if;
  if not exists (select 1 from public.profiles me where me.user_id = u and me.gender is not null) then raise exception 'LOVOKI_PROFILE_INCOMPLETE: gender'; end if;
  day := public._discover_cursor_day(p_cursor);
  if p_cursor is not null then ch := split_part(p_cursor, '|', 2); cid := split_part(p_cursor, '|', 3)::uuid; end if;
  seed := u::text || ':' || day::text || ':';
  select dp.filter_intentions, dp.filter_interests into fint, fi from public.dating_preferences dp where dp.user_id = u;

  select array_agg(c.id order by c.h, c.id) into ids from (
    select t.user_id as id, md5(seed || t.user_id::text) as h
    from public.profiles t
    where t.user_id <> u
      and public._dating_eligible(u, t.user_id, false)
      and not exists (select 1 from public.dating_actions a where a.actor_id = u and a.target_id = t.user_id
                      and (a.action = 'like' or (a.action = 'pass' and a.created_at > now() - make_interval(days => public._pass_days()))))
      and (cardinality(fint) = 0 or t.intention = any (fint))
      and (cardinality(fi) = 0 or exists (select 1 from public.profile_interests pi where pi.user_id = t.user_id and pi.slug = any (fi)))
      and (ch is null or (md5(seed || t.user_id::text), t.user_id) > (ch, cid))
    order by md5(seed || t.user_id::text), t.user_id
    limit public._page_size(p_limit) + 1) c;

  return query
    select c.user_id, c.display_name, c.age, c.gender, c.area_label, c.distance_bucket, c.intention, c.interests, c.prompts, c.photo_paths, c.bio,
           day::text || '|' || md5(seed || c.user_id::text) || '|' || c.user_id::text
    from public._dating_cards(u, coalesce(ids, '{}')) c
    join unnest(coalesce(ids, '{}')) with ordinality o(id, ord) on o.id = c.user_id
    order by o.ord;
end $$;

-- One person's card, for the detail view: only if they are eligible for you or matched with you.
create function public.dating_profile(p_user uuid)
returns table (
  user_id uuid, display_name text, age int, gender text, area_label text, distance_bucket text, intention text,
  interests text[], prompts jsonb, photo_paths text[], bio text, pronouns text, is_match boolean, match_id uuid, matched_at timestamptz
) language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); mid uuid;
begin
  mid := public._active_match(u, p_user);
  if mid is null and not public._dating_eligible(u, p_user, false) then return; end if;
  return query select c.user_id, c.display_name, c.age, c.gender, c.area_label, c.distance_bucket, c.intention, c.interests, c.prompts, c.photo_paths, c.bio,
                      c.pronouns, c.is_match, mid, (select m.created_at from public.matches m where m.id = mid)
               from public._dating_cards(u, array[p_user]) c;
end $$;

create function public.list_matches(p_limit int default 20, p_cursor text default null)
returns table (
  match_id uuid, matched_at timestamptz, user_id uuid, display_name text, age int, gender text, area_label text, distance_bucket text,
  intention text, interests text[], prompts jsonb, photo_paths text[], bio text, pronouns text, page_cursor text
) language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  return query
    select m.id, m.created_at, c.user_id, c.display_name, c.age, c.gender, c.area_label, c.distance_bucket, c.intention, c.interests, c.prompts,
           c.photo_paths, c.bio, c.pronouns, public._make_cursor(m.created_at, m.id)
    from public.matches m
    cross join lateral (select case when m.user_a = u then m.user_b else m.user_a end as other) o
    join lateral public._dating_cards(u, array[o.other]) c on true
    where m.unmatched_at is null and (m.user_a = u or m.user_b = u)
      and (p_cursor is null or (m.created_at, m.id) < (public._cursor_ts(p_cursor), public._cursor_id(p_cursor)))
      and not public._blocked_between(u, o.other)
    order by m.created_at desc, m.id desc
    limit public._page_size(p_limit) + 1;
end $$;

/* ---------------------------------------------------------- function grants */

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
    '_limit_daily_likes', '_limit_discover_hourly', '_pass_days', '_haversine_km', '_bucket', '_effective_max_km', '_gender_wanted', '_active_match',
    '_dating_distance', '_dating_eligible', '_rate_hit', '_try_match', 'on_dating_resume', '_dating_cards', '_discover_cursor_day',
    'save_dating_profile', 'save_place', 'clear_place', 'save_dating_filters', 'dating_status', 'like_profile', 'pass_profile', 'unmatch',
    'discover_profiles', 'dating_profile', 'list_matches', 'block_user'])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
    'save_dating_profile', 'save_place', 'clear_place', 'save_dating_filters', 'dating_status', 'like_profile', 'pass_profile', 'unmatch',
    'discover_profiles', 'dating_profile', 'list_matches', 'block_user'])
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
-- can_view_content was replaced (create or replace keeps its privileges); state them again for clarity.
revoke execute on function public.can_view_content(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.can_view_photos_of(text) from public, anon;
grant execute on function public.can_view_photos_of(text) to authenticated;

commit;
