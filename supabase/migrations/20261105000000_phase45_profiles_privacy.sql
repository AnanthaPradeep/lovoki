-- LOVOKI Phase 4.5: Instagram-style profiles, real privacy for private accounts, labelled sample content.
-- Apply ONLY to a local or explicitly identified development Supabase project (see docs/PHASE_4_5_SETUP.md).
--
-- Layers (D1). Two separate things, each explained to the user in Settings > Privacy overview:
--   SOCIAL  : profiles.social_visibility 'public' | 'followers' (the UI calls the second one "private account").
--             A private account hides posts, media, thumbnails and the follower/following lists from non-followers.
--   DATING  : profiles.dating_discoverable ("Show me in Discover"). Dating photos are governed by the Phase 4 rules.
--
-- Rules kept from earlier phases: every table has RLS; clients have no write privilege on any table; every write is a
-- validating SECURITY DEFINER function using auth.uid(); the ONE shared visibility function is can_view_content().
-- This migration EXTENDS that function with three more contexts ('avatar', 'people', 'card'); it adds no second rule.
--
-- Settled transitions
--   public -> private : accepted followers stay; pending requests stay pending; the profile, its posts and its media leave
--                       Explore, search content and non-followers' feeds at once (every read path calls can_view_content).
--                       Likes and comments that people left while the account was public are RETAINED. They are not shown to
--                       people who can no longer see the post, and counts follow the same visibility.
--   private -> public : pending requests are NOT auto-accepted. The old Phase 3 trigger did that; it is removed. The owner decides
--                       in Requests. (Content is public at that moment anyway, so no one loses or gains access by the choice.)
--   remove follower / block : access ends at once for database reads; a signed URL already issued stays valid until its
--                       short TTL (120 s) runs out. That residual window is documented in docs/PHASE_4_5_SETUP.md.

begin;

/* ------------------------------------------------------------- environment */

create table public.app_config (
  id boolean primary key default true check (id),
  environment text not null default 'development' check (environment in ('development', 'production'))
);
insert into public.app_config default values;
alter table public.app_config enable row level security;
revoke all on table public.app_config from public, anon, authenticated;

-- Changeable only by a migration: a migration sets lovoki.allow_config_change for its own transaction.
create function public._guard_app_config() returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_setting('lovoki.allow_config_change', true) is distinct from 'on' then
    raise exception 'LOVOKI_CONFIG_LOCKED: app_config changes only through a migration';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger app_config_guard before update or delete on public.app_config
  for each row execute function public._guard_app_config();

create function public._is_development() returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select environment = 'development' from public.app_config limit 1), false) $$;

/* -------------------------------------------------------- profile columns */

alter table public.profiles
  add column avatar_blurhash text check (avatar_blurhash is null or avatar_blurhash ~ '^[0-9A-Za-z#$%*+,.:;=?@\[\]^_{|}~-]{6,120}$'),
  add column show_avatar_to_everyone boolean not null default false,
  add column is_sample boolean not null default false,
  add column searchable_by_username boolean not null default true;

alter table public.posts add column is_sample boolean not null default false;
alter table public.post_comments add column is_sample boolean not null default false;

-- Sample rows exist only while app_config.environment = 'development'. posts and comments inherit the flag from their author,
-- so nothing a client sends can set or clear it (clients cannot write these tables at all).
create function public._guard_sample() returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name <> 'profiles' then
    new.is_sample := exists (select 1 from public.profiles p where p.user_id = new.author_id and p.is_sample);
  end if;
  if new.is_sample and not public._is_development() then
    raise exception 'LOVOKI_SAMPLE_FORBIDDEN: sample rows exist only in a development environment';
  end if;
  return new;
end $$;
create trigger profiles_guard_sample before insert or update of is_sample on public.profiles
  for each row execute function public._guard_sample();
create trigger posts_guard_sample before insert on public.posts for each row execute function public._guard_sample();
create trigger comments_guard_sample before insert on public.post_comments for each row execute function public._guard_sample();

create function public._is_sample(p_user uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select p.is_sample from public.profiles p where p.user_id = p_user), false) $$;

/* ------------------------------------------------------ post media columns */

alter table public.post_media
  add column kind text not null default 'image' check (kind in ('image', 'video')),
  add column width int check (width between 1 and 8000),
  add column height int check (height between 1 and 8000),
  add column blurhash text check (blurhash is null or blurhash ~ '^[0-9A-Za-z#$%*+,.:;=?@\[\]^_{|}~-]{6,120}$'),
  add column thumb_path text unique;

alter table public.post_media drop constraint post_media_content_type_check;
alter table public.post_media add constraint post_media_kind_type check (
  (kind = 'image' and content_type in ('image/jpeg', 'image/png', 'image/webp'))
  or (kind = 'video' and content_type in ('video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'image/webp')));
alter table public.post_media add constraint post_media_thumb_shape check (thumb_path is null or thumb_path ~
  ('^' || user_id::text || '/' || post_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'));
alter table public.post_media add constraint post_media_size_pair check ((width is null) = (height is null));

/* ------------------------------------- the single shared visibility function */

-- Contexts: 'public' / 'followers' (content), 'dating' (Phase 4), plus
--   'avatar' : may this viewer SEE the owner's real profile picture?  accepted follower, public account, or the owner chose
--              "show my profile picture to everyone". Never for blocked or unfinished profiles.
--   'people' : may this viewer see the owner's follower and following lists?  Same as the content rule, and the owner has not hidden counts.
--   'card'   : may this viewer see the limited card (handle, name, blurred-or-allowed avatar, lock)?  any finished, unblocked profile.
create or replace function public.can_view_content(p_viewer uuid, p_author uuid, p_audience text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare vis text; effective text; everyone boolean; counts boolean;
begin
  if p_viewer is null or p_author is null then return false; end if;
  if p_viewer = p_author then return true; end if;
  if p_audience = 'dating' then
    return public._active_match(p_viewer, p_author) is not null or public._dating_eligible(p_viewer, p_author, false);
  end if;
  if p_audience not in ('public', 'followers', 'avatar', 'people', 'card') then return false; end if;
  if public._blocked_between(p_viewer, p_author) then return false; end if;
  if not (public._is_completed(p_viewer) and public._is_completed(p_author)) then return false; end if;
  if p_audience = 'card' then return true; end if;
  select social_visibility, show_avatar_to_everyone, show_follower_counts into vis, everyone, counts from public.profiles where user_id = p_author;
  if vis is null then return false; end if;
  if p_audience = 'avatar' and everyone then return true; end if;
  if p_audience = 'people' and not counts then return false; end if;
  effective := case when p_audience = 'followers' or vis = 'followers' then 'followers' else 'public' end;
  if effective = 'public' then return true; end if;
  return exists (select 1 from public.follows f
    where f.follower_id = p_viewer and f.followee_id = p_author and f.status = 'accepted');
end $$;

-- The avatar a viewer may be told about. NULL for a non-follower of a private account (unless the owner opted in).
create function public._social_avatar_path(p_viewer uuid, p_owner uuid) returns text language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_view_content(p_viewer, p_owner, 'avatar') then return null; end if;
  return public._avatar_path(p_owner);
end $$;

-- Storage read rule for profile photos: the Phase 4 rule, plus ONLY the avatar file when the owner opted in.
create function public.can_read_profile_photo(p_name text) returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := auth.uid(); o uuid; folder text := (storage.foldername(p_name))[1];
begin
  if u is null or folder is null then return false; end if;
  if folder = u::text then return true; end if;
  if public.can_view_photos_of(folder) then return true; end if;
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  o := folder::uuid;
  return public.can_view_content(u, o, 'avatar') and public._avatar_path(o) = p_name;
end $$;

drop policy "profile photos: read own or visible" on storage.objects;
create policy "profile photos: read own or visible" on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos' and public.can_read_profile_photo(name));

/* ----------------------------------------------- notifications and reports */

create or replace function public._notify(p_recipient uuid, p_actor uuid, p_type text, p_post uuid default null, p_comment uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_recipient = p_actor or public._blocked_between(p_recipient, p_actor) then return; end if;
  if public._is_sample(p_recipient) then return; end if; -- a sample account is not a person: nothing is delivered to it
  insert into public.notifications (recipient_id, actor_id, type, post_id, comment_id)
    values (p_recipient, p_actor, p_type, p_post, p_comment)
    on conflict do nothing;
end $$;

create or replace function public.report_content(p_type text, p_target uuid, p_reason text, p_details text default '')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); d text := btrim(coalesce(p_details, '')); ok boolean := false; rid uuid; a uuid; aud text;
begin
  if p_type not in ('post', 'comment', 'profile') then raise exception 'LOVOKI_INVALID: target_type'; end if;
  if p_reason not in ('spam', 'harassment', 'hate', 'sexual_content', 'self_harm', 'scam', 'impersonation', 'underage', 'other') then
    raise exception 'LOVOKI_INVALID: reason';
  end if;
  if char_length(d) > 500 then raise exception 'LOVOKI_INVALID: details'; end if;
  if p_type = 'post' then
    select author_id, audience into a, aud from public.posts where id = p_target;
    ok := a is not null and a <> u and public.can_view_content(u, a, aud);
  elsif p_type = 'comment' then
    select c.author_id, p.author_id, p.audience into a, rid, aud
      from public.post_comments c join public.posts p on p.id = c.post_id where c.id = p_target;
    ok := a is not null and a <> u and public.can_view_content(u, rid, aud) and not public._blocked_between(u, a);
    rid := null;
  else
    a := p_target;
    ok := p_target <> u and not public._blocked_between(u, p_target) and public._is_completed(p_target);
  end if;
  if not ok then raise exception 'LOVOKI_NOT_FOUND'; end if;
  -- Said only after the visibility check above, so it cannot be used to find out which hidden ids are samples.
  if public._is_sample(a) then raise exception 'LOVOKI_SAMPLE_TARGET'; end if;
  select id into rid from public.content_reports
    where reporter_id = u and target_type = p_type and target_id = p_target and status = 'open';
  if rid is not null then return rid; end if;
  if (select count(*) from public.content_reports where reporter_id = u and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'LOVOKI_RATE_LIMITED';
  end if;
  insert into public.content_reports (reporter_id, target_type, target_id, reason, details)
    values (u, p_type, p_target, p_reason, d) returning id into rid;
  return rid;
end $$;

/* Dating: a like on a sample profile stores nothing and never matches. */
create or replace function public.like_profile(p_target uuid)
returns table (matched boolean, match_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); mid uuid; liked boolean; cnt int;
begin
  if p_target is null or p_target = u then raise exception 'LOVOKI_INVALID: target'; end if;
  if not exists (select 1 from public.profiles where user_id = u and dating_discoverable) then raise exception 'LOVOKI_PAUSED'; end if;
  if not exists (select 1 from public.profiles where user_id = u and gender is not null) then raise exception 'LOVOKI_PROFILE_INCOMPLETE: gender'; end if;
  if public._is_sample(p_target) then return query select false, null::uuid; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('lovoki:pair:' || least(u, p_target)::text || greatest(u, p_target)::text, 0));
  mid := public._active_match(u, p_target);
  if mid is not null then return query select true, mid; return; end if;
  liked := exists (select 1 from public.dating_actions where actor_id = u and target_id = p_target and action = 'like');
  if not liked then
    select count(*)::int into cnt from public.dating_actions where actor_id = u and action = 'like' and created_at > now() - interval '24 hours';
    if cnt >= public._limit_daily_likes() then raise exception 'LOVOKI_DAILY_LIMIT'; end if;
  end if;
  if not public._dating_eligible(u, p_target, true) then return query select false, null::uuid; return; end if;
  insert into public.dating_actions (actor_id, target_id, action) values (u, p_target, 'like')
    on conflict (actor_id, target_id) do update set action = 'like', created_at = now() where public.dating_actions.action = 'pass';
  mid := public._try_match(u, p_target);
  return query select mid is not null, mid;
end $$;

-- Which of these people are sample accounts? Reveals nothing but the flag, for ids the caller already holds from a card.
create function public.sample_flags(p_ids uuid[]) returns table (user_id uuid, is_sample boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  if cardinality(coalesce(p_ids, '{}')) > 50 then raise exception 'LOVOKI_INVALID: ids'; end if;
  return query select p.user_id, p.is_sample from public.profiles p where p.user_id = any (p_ids) and p.is_sample;
end $$;

/* ------------------------------------------------------- follow transitions */

-- Phase 3 accepted every pending request when an account went public. That made follows nobody had approved. Removed.
drop trigger profiles_visibility_change on public.profiles;
drop function public.on_visibility_change();

create function public.set_account_private(p_private boolean) returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  if p_private is null then raise exception 'LOVOKI_INVALID: private'; end if;
  update public.profiles set social_visibility = case when p_private then 'followers' else 'public' end where user_id = u;
  if not found then raise exception 'LOVOKI_NOT_FOUND'; end if;
end $$;

/* ------------------------------------------------------------ own settings */

drop function public.save_social_settings(text, boolean);
create function public.save_social_settings(p_allow_comments text, p_show_follower_counts boolean, p_searchable boolean default true, p_show_avatar_to_everyone boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  if p_allow_comments is null or p_allow_comments not in ('everyone', 'followers', 'nobody') then raise exception 'LOVOKI_INVALID: allow_comments'; end if;
  update public.profiles set allow_comments = p_allow_comments, show_follower_counts = coalesce(p_show_follower_counts, true),
    searchable_by_username = coalesce(p_searchable, true), show_avatar_to_everyone = coalesce(p_show_avatar_to_everyone, false)
    where user_id = u;
end $$;

drop function public.save_avatar(uuid, jsonb);
create function public.save_avatar(p_photo_id uuid, p_crop jsonb, p_blurhash text default null) returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  if p_photo_id is not null and not exists (select 1 from public.profile_photos where id = p_photo_id and user_id = u) then raise exception 'LOVOKI_INVALID: avatar'; end if;
  if p_crop is not null and not (jsonb_typeof(p_crop) = 'object' and (p_crop ->> 'x') ~ '^[0-9.]+$' and (p_crop ->> 'y') ~ '^[0-9.]+$' and (p_crop ->> 'zoom') ~ '^[0-9.]+$'
      and (p_crop ->> 'x')::numeric between 0 and 1 and (p_crop ->> 'y')::numeric between 0 and 1 and (p_crop ->> 'zoom')::numeric between 1 and 3) then
    raise exception 'LOVOKI_INVALID: crop';
  end if;
  if p_blurhash is not null and p_blurhash !~ '^[0-9A-Za-z#$%*+,.:;=?@\[\]^_{|}~-]{6,120}$' then raise exception 'LOVOKI_INVALID: blurhash'; end if;
  update public.profiles set avatar_photo_id = p_photo_id,
    avatar_blurhash = case when p_photo_id is null then null else p_blurhash end,
    avatar_crop = case when p_photo_id is null then null else jsonb_build_object('x', (p_crop ->> 'x')::numeric, 'y', (p_crop ->> 'y')::numeric, 'zoom', (p_crop ->> 'zoom')::numeric) end
    where user_id = u;
end $$;

/* ----------------------------------------------------------------- posts */

drop function public.create_post(uuid, text, text, text);
create function public.create_post(p_post_id uuid, p_caption text, p_audience text, p_media_path text default null,
                                   p_thumb_path text default null, p_width int default null, p_height int default null, p_blurhash text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); cap text := btrim(coalesce(p_caption, '')); meta jsonb; tmeta jsonb;
        shape text := '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$';
begin
  if p_post_id is null then raise exception 'LOVOKI_INVALID: post_id'; end if;
  if p_audience not in ('public', 'followers') then raise exception 'LOVOKI_INVALID: audience'; end if;
  if char_length(cap) > 2200 then raise exception 'LOVOKI_INVALID: caption'; end if;
  if cap = '' and p_media_path is null then raise exception 'LOVOKI_INVALID: empty_post'; end if;
  if p_media_path is null and (p_thumb_path is not null or p_width is not null or p_height is not null or p_blurhash is not null) then raise exception 'LOVOKI_INVALID: media_fields'; end if;
  if (p_width is null) <> (p_height is null) or p_width < 1 or p_height < 1 or p_width > 8000 or p_height > 8000 then raise exception 'LOVOKI_INVALID: size'; end if;
  if p_blurhash is not null and p_blurhash !~ '^[0-9A-Za-z#$%*+,.:;=?@\[\]^_{|}~-]{6,120}$' then raise exception 'LOVOKI_INVALID: blurhash'; end if;
  if exists (select 1 from public.posts where id = p_post_id) then
    if exists (select 1 from public.posts where id = p_post_id and author_id = u) then return p_post_id; end if;
    raise exception 'LOVOKI_INVALID: duplicate_post';
  end if;
  insert into public.posts (id, author_id, caption, audience) values (p_post_id, u, cap, p_audience);
  if p_media_path is not null then
    if p_media_path !~ ('^' || u::text || '/' || p_post_id::text || shape) then raise exception 'LOVOKI_INVALID: media_path'; end if;
    select o.metadata into meta from storage.objects o where o.bucket_id = 'post-media' and o.name = p_media_path;
    if meta is null or meta ->> 'mimetype' is null or meta ->> 'size' is null then raise exception 'LOVOKI_PHOTO_MISSING'; end if;
    if p_thumb_path is not null then
      if p_thumb_path = p_media_path or p_thumb_path !~ ('^' || u::text || '/' || p_post_id::text || shape) then raise exception 'LOVOKI_INVALID: thumb_path'; end if;
      select o.metadata into tmeta from storage.objects o where o.bucket_id = 'post-media' and o.name = p_thumb_path;
      if tmeta is null or tmeta ->> 'mimetype' is null then raise exception 'LOVOKI_PHOTO_MISSING'; end if;
    end if;
    insert into public.post_media (post_id, user_id, storage_path, content_type, size_bytes, kind, width, height, blurhash, thumb_path)
      values (p_post_id, u, p_media_path, meta ->> 'mimetype', (meta ->> 'size')::int, 'image', p_width, p_height, p_blurhash, p_thumb_path);
  end if;
  return p_post_id;
end $$;

drop function public.delete_post(uuid);
create function public.delete_post(p_post uuid) returns text[] language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); paths text[];
begin
  if not exists (select 1 from public.posts where id = p_post and author_id = u) then raise exception 'LOVOKI_NOT_FOUND'; end if;
  select coalesce(array_agg(x), '{}') into paths from (
    select storage_path as x from public.post_media where post_id = p_post
    union all select thumb_path from public.post_media where post_id = p_post and thumb_path is not null) s;
  delete from public.posts where id = p_post and author_id = u;
  return paths;
end $$;

-- Thumbnails follow exactly the audience of the original: the same lookup, either column.
create or replace function public.can_read_post_media(p_name text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := auth.uid(); a uuid; aud text;
begin
  if u is null then return false; end if;
  select po.author_id, po.audience into a, aud
    from public.post_media pm join public.posts po on po.id = pm.post_id where pm.storage_path = p_name or pm.thumb_path = p_name;
  if a is null then return (storage.foldername(p_name))[1] = u::text; end if;
  return public.can_view_content(u, a, aud);
end $$;

drop policy "post media: upload own" on storage.objects;
create policy "post media: upload own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
    and public.own_post_media_object_count() < 120);

create or replace function public.orphan_post_media(p_older_than interval default interval '1 day')
returns setof text language sql stable security definer set search_path = ''
as $$
  select o.name from storage.objects o
  where o.bucket_id = 'post-media' and o.created_at < now() - p_older_than
    and not exists (select 1 from public.post_media pm where pm.storage_path = o.name or pm.thumb_path = o.name)
$$;

/* ---------------------------------------------------------- post read pages */

drop function public.feed_page(text, int, text);
drop function public.profile_posts_page(uuid, int, text);
drop function public.saved_posts_page(int, text);
drop function public.post_page(uuid);
drop function public._post_rows(uuid, text, uuid, int, text);

create type public.post_row as (
  post_id uuid, author_id uuid, author_username text, author_name text, author_photo_path text, author_blurhash text, author_private boolean,
  is_sample boolean, caption text, audience text, created_at timestamptz,
  media_path text, media_type text, media_kind text, thumb_path text, media_width int, media_height int, media_blurhash text, media_count int,
  like_count int, comment_count int, liked_by_me boolean, saved_by_me boolean, is_mine boolean, page_cursor text, comments_allowed boolean);

create function public._post_rows(p_viewer uuid, p_mode text, p_author uuid, p_limit int, p_cursor text)
returns setof public.post_row language sql stable security definer set search_path = ''
as $$
  select po.id, po.author_id, pr.username::text, pr.display_name, public._social_avatar_path(p_viewer, po.author_id), pr.avatar_blurhash,
         pr.social_visibility = 'followers', po.is_sample, po.caption, po.audience, po.created_at,
         m.storage_path, m.content_type, m.kind, m.thumb_path, m.width, m.height, m.blurhash, case when m.storage_path is null then 0 else 1 end,
         public._like_count(p_viewer, po.id), public._comment_count(p_viewer, po.id),
         exists (select 1 from public.post_likes l where l.post_id = po.id and l.user_id = p_viewer),
         exists (select 1 from public.post_saves s where s.post_id = po.id and s.user_id = p_viewer),
         po.author_id = p_viewer, public._make_cursor(po.created_at, po.id),
         public._comments_allowed(p_viewer, po.author_id)
  from public.posts po
  join public.profiles pr on pr.user_id = po.author_id
  left join lateral (select pm.storage_path, pm.content_type, pm.kind, pm.thumb_path, pm.width, pm.height, pm.blurhash
                     from public.post_media pm where pm.post_id = po.id and pm.position = 0) m on true
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
returns setof public.post_row language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  if p_feed not in ('explore', 'following') then raise exception 'LOVOKI_INVALID: feed'; end if;
  return query select * from public._post_rows(u, p_feed, null, p_limit, p_cursor);
end $$;

create function public.profile_posts_page(p_author uuid, p_limit int default 15, p_cursor text default null)
returns setof public.post_row language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  return query select * from public._post_rows(u, 'author', p_author, p_limit, p_cursor);
end $$;

-- The profile grid, addressed by handle. A viewer who may not see the account's posts gets an empty page, the same answer as "no posts".
create function public.list_profile_posts(p_handle text, p_limit int default 15, p_cursor text default null)
returns setof public.post_row language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); t uuid;
begin
  select user_id into t from public.profiles where username = lower(btrim(coalesce(p_handle, '')))::extensions.citext;
  if t is null then return; end if;
  return query select * from public._post_rows(u, 'author', t, p_limit, p_cursor);
end $$;

create function public.saved_posts_page(p_limit int default 15, p_cursor text default null)
returns setof public.post_row language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  return query select * from public._post_rows(u, 'saved', null, p_limit, p_cursor);
end $$;

create function public.post_page(p_post uuid)
returns setof public.post_row language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  return query select * from public._post_rows(u, 'post', p_post, 1, null) limit 1;
end $$;

/* ------------------------------------------------------------- profiles */

-- ONE place that decides what a viewer learns about a profile. Both public entry points below call it.
drop function public.social_profile(uuid);
create function public._social_profile(v uuid, t uuid)
returns table (
  user_id uuid, username text, display_name text, pronouns text, bio text, area_label text, age int, gender text, gender_custom text,
  photo_path text, avatar_crop jsonb, avatar_blurhash text, interests text[], prompts jsonb, details jsonb,
  restricted boolean, is_private boolean, is_self boolean, is_sample boolean, relationship text, follow_status text, follows_me_status text,
  follower_count int, following_count int, post_count int
) language plpgsql stable security definer set search_path = ''
as $$
declare full_view boolean; show_counts boolean;
begin
  if v is null or t is null or public._blocked_between(v, t) or not public._is_completed(t) or not public._is_completed(v) then return; end if;
  full_view := public.can_view_content(v, t, 'public');
  select (pr.show_follower_counts or pr.user_id = v) into show_counts from public.profiles pr where pr.user_id = t;
  return query
    select pr.user_id, pr.username::text, pr.display_name,
           case when full_view then pr.pronouns end,
           pr.bio,                                           -- D3: a private account's bio stays visible
           case when full_view then pr.area_label end,
           case when full_view then public.age_of(pv.date_of_birth) end,
           case when full_view and pr.show_gender then pr.gender end, case when full_view and pr.show_gender then pr.gender_custom end,
           public._social_avatar_path(v, t), case when public.can_view_content(v, t, 'avatar') then pr.avatar_crop end, pr.avatar_blurhash,
           case when full_view then coalesce((select array_agg(pi.slug order by pi.slug) from public.profile_interests pi where pi.user_id = pr.user_id), '{}') end,
           case when full_view then coalesce((select jsonb_agg(jsonb_build_object('question', pp.question, 'answer', pp.answer) order by pp.position) from public.profile_prompts pp where pp.user_id = pr.user_id), '[]'::jsonb) end,
           case when full_view then public._visible_details(v, pr.user_id, 'social') else '{}'::jsonb end,
           not full_view, pr.social_visibility = 'followers', pr.user_id = v, pr.is_sample,
           case when pr.user_id = v then 'self'
                when exists (select 1 from public.follows f where f.follower_id = v and f.followee_id = pr.user_id and f.status = 'accepted') then 'follower'
                when exists (select 1 from public.follows f where f.follower_id = v and f.followee_id = pr.user_id and f.status = 'pending') then 'pending'
                else 'stranger' end,
           (select f.status from public.follows f where f.follower_id = v and f.followee_id = pr.user_id),
           (select f.status from public.follows f where f.follower_id = pr.user_id and f.followee_id = v),
           case when show_counts then (select count(*)::int from public.follows f where f.followee_id = pr.user_id and f.status = 'accepted') end,
           case when show_counts then (select count(*)::int from public.follows f where f.follower_id = pr.user_id and f.status = 'accepted') end,
           -- D3: strangers of a private account still see HOW MANY posts exist (never which). Everyone else counts what they may see.
           case when not show_counts then null
                when full_view then (select count(*)::int from public.posts po where po.author_id = pr.user_id and public.can_view_content(v, po.author_id, po.audience))
                else (select count(*)::int from public.posts po where po.author_id = pr.user_id) end
    from public.profiles pr join public.profiles_private pv on pv.user_id = pr.user_id
    where pr.user_id = t;
end $$;

create function public.get_social_profile(p_handle text)
returns table (
  user_id uuid, username text, display_name text, pronouns text, bio text, area_label text, age int, gender text, gender_custom text,
  photo_path text, avatar_crop jsonb, avatar_blurhash text, interests text[], prompts jsonb, details jsonb,
  restricted boolean, is_private boolean, is_self boolean, is_sample boolean, relationship text, follow_status text, follows_me_status text,
  follower_count int, following_count int, post_count int
) language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); t uuid;
begin
  select pr.user_id into t from public.profiles pr where pr.username = lower(btrim(coalesce(p_handle, '')))::extensions.citext;
  return query select * from public._social_profile(u, t);
end $$;

create function public.social_profile(p_user uuid)
returns table (
  user_id uuid, username text, display_name text, pronouns text, bio text, area_label text, age int, gender text, gender_custom text,
  photo_path text, avatar_crop jsonb, avatar_blurhash text, interests text[], prompts jsonb, details jsonb,
  restricted boolean, is_private boolean, is_self boolean, is_sample boolean, relationship text, follow_status text, follows_me_status text,
  follower_count int, following_count int, post_count int
) language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  return query select * from public._social_profile(u, p_user);
end $$;

/* ------------------------------------------------- people lists and search */

create type public.person_card as (
  user_id uuid, username text, display_name text, photo_path text, avatar_blurhash text, avatar_crop jsonb,
  is_private boolean, is_sample boolean, follow_status text, page_cursor text);

create function public._profile_people(v uuid, t uuid, p_kind text, p_limit int, p_cursor text)
returns setof public.person_card language plpgsql stable security definer set search_path = ''
as $$
begin
  if t is null or p_kind not in ('followers', 'following') then return; end if;
  -- Gate: self, or a viewer who may see this account's content and whose owner has not hidden the lists.
  if not public.can_view_content(v, t, 'people') then return; end if;
  return query
    select pr.user_id, pr.username::text, pr.display_name, public._social_avatar_path(v, pr.user_id), pr.avatar_blurhash,
           case when public.can_view_content(v, pr.user_id, 'avatar') then pr.avatar_crop end,
           pr.social_visibility = 'followers', pr.is_sample,
           (select f2.status from public.follows f2 where f2.follower_id = v and f2.followee_id = pr.user_id),
           public._make_cursor(f.created_at, pr.user_id)
    from public.follows f
    join public.profiles pr on pr.user_id = case when p_kind = 'followers' then f.follower_id else f.followee_id end
    where f.status = 'accepted' and (case when p_kind = 'followers' then f.followee_id else f.follower_id end) = t
      and public.can_view_content(v, pr.user_id, 'card')
      and (p_cursor is null or (f.created_at, pr.user_id) < (public._cursor_ts(p_cursor), public._cursor_id(p_cursor)))
    order by f.created_at desc, pr.user_id desc
    limit public._page_size(p_limit) + 1;
end $$;

create function public.list_followers(p_handle text, p_limit int default 20, p_cursor text default null)
returns setof public.person_card language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); t uuid;
begin
  select pr.user_id into t from public.profiles pr where pr.username = lower(btrim(coalesce(p_handle, '')))::extensions.citext;
  return query select * from public._profile_people(u, t, 'followers', p_limit, p_cursor);
end $$;

create function public.list_following(p_handle text, p_limit int default 20, p_cursor text default null)
returns setof public.person_card language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); t uuid;
begin
  select pr.user_id into t from public.profiles pr where pr.username = lower(btrim(coalesce(p_handle, '')))::extensions.citext;
  return query select * from public._profile_people(u, t, 'following', p_limit, p_cursor);
end $$;

-- Prefix search on @handle and on any word of the display name. Returns the limited card only.
create function public.search_profiles(p_q text, p_limit int default 10)
-- Volatile on purpose: every call records a rate-limit hit.
returns setof public.person_card language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); q text := lower(btrim(coalesce(p_q, ''))); esc text; lim int := least(greatest(coalesce(p_limit, 10), 1), 20);
begin
  if char_length(q) < 2 or char_length(q) > 40 then return; end if;
  perform public._rate_hit('search', 40, 'minute');
  esc := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select pr.user_id, pr.username::text, pr.display_name, public._social_avatar_path(u, pr.user_id), pr.avatar_blurhash,
           case when public.can_view_content(u, pr.user_id, 'avatar') then pr.avatar_crop end,
           pr.social_visibility = 'followers', pr.is_sample,
           (select f.status from public.follows f where f.follower_id = u and f.followee_id = pr.user_id),
           null::text
    from public.profiles pr
    where pr.user_id <> u and pr.searchable_by_username and pr.username is not null
      and public.can_view_content(u, pr.user_id, 'card')
      and (pr.username::text like esc || '%' escape '\'
           or lower(pr.display_name) like esc || '%' escape '\' or lower(pr.display_name) like '% ' || esc || '%' escape '\')
    order by (pr.username::text = q) desc, (pr.username::text like esc || '%' escape '\') desc, pr.username::text
    limit lim;
end $$;

/* ------------------------------------------------------------ safe lists */

-- "Suggested people" for an account that follows nobody: public, finished, unblocked, same country first. No personalisation.
create function public.suggested_people(p_limit int default 12)
returns setof public.person_card language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); cc text;
begin
  select pl.country_code into cc from public.profile_places mp join public.places pl on pl.id = mp.place_id where mp.user_id = u;
  return query
    select pr.user_id, pr.username::text, pr.display_name, public._social_avatar_path(u, pr.user_id), pr.avatar_blurhash,
           case when public.can_view_content(u, pr.user_id, 'avatar') then pr.avatar_crop end,
           false, pr.is_sample, null::text, null::text
    from public.profiles pr left join public.profile_places pp on pp.user_id = pr.user_id left join public.places pl on pl.id = pp.place_id
    where pr.user_id <> u and pr.social_visibility = 'public' and pr.username is not null
      and public.can_view_content(u, pr.user_id, 'public')
      and not exists (select 1 from public.follows f where f.follower_id = u and f.followee_id = pr.user_id)
    order by (pl.country_code is not distinct from cc) desc, pr.created_at desc, pr.user_id
    limit least(greatest(coalesce(p_limit, 12), 1), 20);
end $$;

/* ---------------------------------------------------------- function grants */

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
    '_guard_app_config', '_is_development', '_guard_sample', '_is_sample', '_social_avatar_path', 'can_read_profile_photo', 'sample_flags',
    'set_account_private', 'save_social_settings', 'save_avatar', 'create_post', 'delete_post', 'can_read_post_media', 'orphan_post_media', '_post_rows',
    'feed_page', 'profile_posts_page', 'list_profile_posts', 'saved_posts_page', 'post_page', '_social_profile', 'get_social_profile', 'social_profile',
    '_profile_people', 'list_followers', 'list_following', 'search_profiles', 'suggested_people', 'like_profile', 'report_content', '_notify', 'can_view_content'])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
    'sample_flags', 'set_account_private', 'save_social_settings', 'save_avatar', 'create_post', 'delete_post',
    'feed_page', 'profile_posts_page', 'list_profile_posts', 'saved_posts_page', 'post_page', 'get_social_profile', 'social_profile',
    'list_followers', 'list_following', 'search_profiles', 'suggested_people', 'like_profile', 'report_content'])
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
-- Storage policies run as the caller, so the read helpers stay executable by authenticated.
grant execute on function public.can_read_post_media(text) to authenticated;
grant execute on function public.can_read_profile_photo(text) to authenticated;
grant execute on function public.orphan_post_media(interval) to service_role;

commit;
