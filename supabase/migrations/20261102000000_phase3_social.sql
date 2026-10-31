-- LOVOKI Phase 3: social layer (posts, follows, likes, saves, comments, notifications, reports, blocks).
-- Apply ONLY to a local or explicitly identified development Supabase project (see docs/PHASE_3_SETUP.md).
--
-- Security model (same as Phase 2)
--   * Every table has RLS enabled. Clients have NO insert/update/delete privilege on any table.
--     All writes go through SECURITY DEFINER functions that validate input and use auth.uid().
--   * Clients have no SELECT privilege on posts, post_media, post_likes, post_comments. Those are
--     read only through the page functions below, which all call the ONE visibility function
--     public.can_view_content(). Phase 4 extends that function; nothing else decides who sees what.
--   * Own-row SELECT policies exist only for notifications, post_saves, content_reports, blocks, follows.
--   * Dating state (dating_preferences, dating_discoverable, any future like/match) is never read by
--     the social functions. The single exception is the pre-existing photo read rule, which keeps
--     the Phase 2 behaviour for discoverable profiles.
--
-- Visibility rules (public.can_view_content(viewer, author, audience))
--   * No viewer, or viewer and author not both "completed" (onboarding done): not visible.
--   * Author always sees own content.
--   * A block in either direction hides everything both ways.
--   * Effective audience is 'followers' when the post audience is 'followers' OR the author's profile is
--     followers-only. Followers-only content is visible to ACCEPTED followers only; pending requests do not count.
--   * Otherwise visible to every completed, unblocked user.
--
-- Settled behaviours
--   * Profile public -> followers-only: accepted followers keep access; strangers lose access to profile and posts
--     (posts leave Explore). The owner can remove followers.
--   * Profile followers-only -> public: pending follow requests become accepted (follow_accepted notification).
--   * Post audience public -> followers: likes, saves and comments stay attached to the post, but every read path
--     re-checks visibility, so people who lost access stop seeing the post, its media, its comments and its notifications.
--   * Blocking removes follows and pending requests in both directions and deletes notifications between the pair.

begin;

/* ------------------------------------------------------------------ tables */

create table public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

create table public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  followee_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default clock_timestamp(),
  accepted_at timestamptz,
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id),
  check ((status = 'accepted') = (accepted_at is not null))
);
create index follows_followee_idx on public.follows (followee_id, status, created_at desc, follower_id);
create index follows_follower_idx on public.follows (follower_id, status, created_at desc, followee_id);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  caption text not null default '' check (char_length(caption) <= 2200),
  audience text not null check (audience in ('public', 'followers')),
  created_at timestamptz not null default clock_timestamp()
);
create index posts_feed_idx on public.posts (created_at desc, id desc);
create index posts_author_idx on public.posts (author_id, created_at desc, id desc);

create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position smallint not null default 0 check (position = 0), -- v1: at most one image per post
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  unique (post_id, position),
  constraint post_media_path_shape check (storage_path ~
    ('^' || user_id::text || '/' || post_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'))
);

create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_idx on public.post_likes (user_id);

create table public.post_saves (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_saves_user_idx on public.post_saves (user_id);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default clock_timestamp()
);
create index post_comments_post_idx on public.post_comments (post_id, created_at, id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('like', 'comment', 'follow', 'follow_request', 'follow_accepted')),
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.post_comments (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  check (recipient_id <> actor_id),
  check ((type in ('like', 'comment')) = (post_id is not null)),
  check ((type = 'comment') = (comment_id is not null))
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc, id desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;
-- Dedupe: at most one like notification per (actor, post), one per follow event type per pair, one per comment.
create unique index notifications_like_uniq on public.notifications (recipient_id, actor_id, post_id) where type = 'like';
create unique index notifications_follow_uniq on public.notifications (recipient_id, actor_id, type)
  where type in ('follow', 'follow_request', 'follow_accepted');
create unique index notifications_comment_uniq on public.notifications (comment_id) where type = 'comment';

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'profile')),
  target_id uuid not null, -- no FK on purpose: a report outlives the content it describes
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'sexual_content', 'self_harm', 'scam', 'impersonation', 'underage', 'other')),
  details text not null default '' check (char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'reviewing', 'closed')),
  created_at timestamptz not null default now()
);
create index content_reports_reporter_idx on public.content_reports (reporter_id, created_at desc);
create unique index content_reports_open_uniq on public.content_reports (reporter_id, target_type, target_id) where status = 'open';

/* --------------------------------------------------- RLS + privileges */

do $$
declare t text;
begin
  foreach t in array array['blocks', 'follows', 'posts', 'post_media', 'post_likes', 'post_saves', 'post_comments',
                           'notifications', 'content_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Own-row reads only. posts, post_media, post_likes and post_comments have NO client read path except the page functions.
create policy blocks_select_own on public.blocks for select to authenticated using (blocker_id = (select auth.uid()));
create policy follows_select_own on public.follows for select to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));
create policy post_saves_select_own on public.post_saves for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_select_own on public.notifications for select to authenticated using (recipient_id = (select auth.uid()));
create policy content_reports_select_own on public.content_reports for select to authenticated using (reporter_id = (select auth.uid()));
grant select on public.blocks, public.follows, public.post_saves, public.notifications, public.content_reports to authenticated;

/* ------------------------------------------------ the shared visibility rule */

create function public._is_completed(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.onboarding_state o where o.user_id = p_user and o.completed_at is not null) $$;

create function public._blocked_between(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a))
$$;

-- THE visibility rule. Every social read path, write precondition and storage policy calls this function.
create function public.can_view_content(p_viewer uuid, p_author uuid, p_audience text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare vis text; effective text;
begin
  if p_viewer is null or p_author is null then return false; end if;
  if p_viewer = p_author then return true; end if;
  if public._blocked_between(p_viewer, p_author) then return false; end if;
  if not (public._is_completed(p_viewer) and public._is_completed(p_author)) then return false; end if;
  select social_visibility into vis from public.profiles where user_id = p_author;
  if vis is null then return false; end if;
  effective := case when p_audience = 'followers' or vis = 'followers' then 'followers' else 'public' end;
  if effective = 'public' then return true; end if;
  return exists (select 1 from public.follows f
    where f.follower_id = p_viewer and f.followee_id = p_author and f.status = 'accepted');
end $$;

/* --------------------------------------------------------- internal helpers */

create function public._notify(p_recipient uuid, p_actor uuid, p_type text, p_post uuid default null, p_comment uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_recipient = p_actor or public._blocked_between(p_recipient, p_actor) then return; end if;
  insert into public.notifications (recipient_id, actor_id, type, post_id, comment_id)
    values (p_recipient, p_actor, p_type, p_post, p_comment)
    on conflict do nothing;
end $$;

create function public._require_completed()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  if not public._is_completed(u) then raise exception 'LOVOKI_ONBOARDING_INCOMPLETE:'; end if;
  return u;
end $$;

-- Cursors are "<timestamp with microseconds>|<uuid>". A malformed cursor is an error, never a fallback to page one,
-- and a well-formed forged cursor can only move the window: every row is still filtered by can_view_content.
create function public._cursor_ts(p_cursor text) returns timestamptz language plpgsql immutable set search_path = ''
as $$
begin
  if p_cursor is null then return null; end if;
  if p_cursor !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'LOVOKI_INVALID_CURSOR';
  end if;
  return split_part(p_cursor, '|', 1)::timestamptz;
end $$;
create function public._cursor_id(p_cursor text) returns uuid language plpgsql immutable set search_path = ''
as $$
begin
  if p_cursor is null then return null; end if;
  perform public._cursor_ts(p_cursor);
  return split_part(p_cursor, '|', 2)::uuid;
end $$;
create function public._make_cursor(p_ts timestamptz, p_id uuid) returns text language sql immutable set search_path = ''
as $$ select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p_id::text $$;

create function public._page_size(p_limit int) returns int language sql immutable set search_path = ''
as $$ select least(greatest(coalesce(p_limit, 15), 10), 20) $$;

/* ----------------------------------------------------------------- posts */

create function public.create_post(p_post_id uuid, p_caption text, p_audience text, p_media_path text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); cap text := btrim(coalesce(p_caption, '')); meta jsonb;
begin
  if p_post_id is null then raise exception 'LOVOKI_INVALID: post_id'; end if;
  if p_audience not in ('public', 'followers') then raise exception 'LOVOKI_INVALID: audience'; end if;
  if char_length(cap) > 2200 then raise exception 'LOVOKI_INVALID: caption'; end if;
  if cap = '' and p_media_path is null then raise exception 'LOVOKI_INVALID: empty_post'; end if;
  if exists (select 1 from public.posts where id = p_post_id) then raise exception 'LOVOKI_INVALID: duplicate_post'; end if;
  insert into public.posts (id, author_id, caption, audience) values (p_post_id, u, cap, p_audience);
  if p_media_path is not null then
    if p_media_path !~ ('^' || u::text || '/' || p_post_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$') then
      raise exception 'LOVOKI_INVALID: media_path';
    end if;
    select o.metadata into meta from storage.objects o where o.bucket_id = 'post-media' and o.name = p_media_path;
    if meta is null or meta ->> 'mimetype' is null or meta ->> 'size' is null then raise exception 'LOVOKI_PHOTO_MISSING'; end if;
    insert into public.post_media (post_id, user_id, storage_path, content_type, size_bytes)
      values (p_post_id, u, p_media_path, meta ->> 'mimetype', (meta ->> 'size')::int);
  end if;
  return p_post_id;
end $$;

-- Returns the stored media paths so the client can remove the files. A failed removal leaves an orphan object
-- that only its owner can read; see docs/PHASE_3_SETUP.md for the sweep.
create function public.delete_post(p_post uuid)
returns text[] language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); paths text[];
begin
  if not exists (select 1 from public.posts where id = p_post and author_id = u) then raise exception 'LOVOKI_NOT_FOUND'; end if;
  select coalesce(array_agg(storage_path), '{}') into paths from public.post_media where post_id = p_post;
  delete from public.posts where id = p_post and author_id = u;
  return paths;
end $$;

create function public.set_post_audience(p_post uuid, p_audience text)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  if p_audience not in ('public', 'followers') then raise exception 'LOVOKI_INVALID: audience'; end if;
  update public.posts set audience = p_audience where id = p_post and author_id = u;
  if not found then raise exception 'LOVOKI_NOT_FOUND'; end if;
end $$;

-- Resolves a post the caller may interact with, or raises LOVOKI_NOT_FOUND (never reveals that it exists).
create function public._visible_post_author(p_viewer uuid, p_post uuid)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare a uuid; aud text;
begin
  select author_id, audience into a, aud from public.posts where id = p_post;
  if a is null or not public.can_view_content(p_viewer, a, aud) then raise exception 'LOVOKI_NOT_FOUND'; end if;
  return a;
end $$;

create function public._like_count(p_viewer uuid, p_post uuid) returns int language sql stable security definer set search_path = ''
as $$ select count(*)::int from public.post_likes l where l.post_id = p_post and not public._blocked_between(p_viewer, l.user_id) $$;

create function public._comment_count(p_viewer uuid, p_post uuid) returns int language sql stable security definer set search_path = ''
as $$ select count(*)::int from public.post_comments c where c.post_id = p_post and not public._blocked_between(p_viewer, c.author_id) $$;

create function public.like_post(p_post uuid)
returns table (liked boolean, like_count int) language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); a uuid; ins int;
begin
  a := public._visible_post_author(u, p_post);
  insert into public.post_likes (post_id, user_id) values (p_post, u) on conflict do nothing;
  get diagnostics ins = row_count;
  if ins > 0 then perform public._notify(a, u, 'like', p_post); end if;
  return query select true, public._like_count(u, p_post);
end $$;

create function public.unlike_post(p_post uuid)
returns table (liked boolean, like_count int) language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); a uuid;
begin
  delete from public.post_likes where post_id = p_post and user_id = u;
  select author_id into a from public.posts where id = p_post;
  if a is not null then
    delete from public.notifications where type = 'like' and post_id = p_post and actor_id = u;
  end if;
  -- The count is only returned when the post is visible, so an unlike can never probe an invisible post.
  if a is not null and public.can_view_content(u, a, (select audience from public.posts where id = p_post)) then
    return query select false, public._like_count(u, p_post);
  end if;
end $$;

create function public.save_post(p_post uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  perform public._visible_post_author(u, p_post);
  insert into public.post_saves (post_id, user_id) values (p_post, u) on conflict do nothing;
  return true;
end $$;

create function public.unsave_post(p_post uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  delete from public.post_saves where post_id = p_post and user_id = u;
  return false;
end $$;

create function public.add_comment(p_post uuid, p_body text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); a uuid; b text := btrim(coalesce(p_body, '')); cid uuid;
begin
  if char_length(b) not between 1 and 300 then raise exception 'LOVOKI_INVALID: comment'; end if;
  a := public._visible_post_author(u, p_post);
  insert into public.post_comments (post_id, author_id, body) values (p_post, u, b) returning id into cid;
  perform public._notify(a, u, 'comment', p_post, cid);
  return cid;
end $$;

create function public.delete_comment(p_comment uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  delete from public.post_comments c
    where c.id = p_comment
      and (c.author_id = u or exists (select 1 from public.posts p where p.id = c.post_id and p.author_id = u));
  if not found then raise exception 'LOVOKI_NOT_FOUND'; end if;
end $$;

/* ------------------------------------------------------------ read pages */

-- One query for every post list. p_mode: explore | following | author | saved.
create function public._post_rows(p_viewer uuid, p_mode text, p_author uuid, p_limit int, p_cursor text)
returns table (
  post_id uuid, author_id uuid, author_name text, author_photo_path text, caption text, audience text,
  created_at timestamptz, media_path text, media_type text, like_count int, comment_count int,
  liked_by_me boolean, saved_by_me boolean, is_mine boolean, page_cursor text
) language sql stable security definer set search_path = ''
as $$
  select po.id, po.author_id, pr.display_name, av.storage_path, po.caption, po.audience, po.created_at,
         m.storage_path, m.content_type,
         public._like_count(p_viewer, po.id), public._comment_count(p_viewer, po.id),
         exists (select 1 from public.post_likes l where l.post_id = po.id and l.user_id = p_viewer),
         exists (select 1 from public.post_saves s where s.post_id = po.id and s.user_id = p_viewer),
         po.author_id = p_viewer,
         public._make_cursor(po.created_at, po.id)
  from public.posts po
  join public.profiles pr on pr.user_id = po.author_id
  left join lateral (select pm.storage_path, pm.content_type from public.post_media pm where pm.post_id = po.id and pm.position = 0) m on true
  left join lateral (select ph.storage_path from public.profile_photos ph where ph.user_id = po.author_id and ph.position = 0
                      and public.can_view_content(p_viewer, po.author_id, 'public')) av on true
  where (p_cursor is null or (po.created_at, po.id) < (public._cursor_ts(p_cursor), public._cursor_id(p_cursor)))
    and public.can_view_content(p_viewer, po.author_id, po.audience)
    and case p_mode
      when 'explore' then po.audience = 'public' and pr.social_visibility = 'public'
      when 'following' then po.author_id = p_viewer
        or exists (select 1 from public.follows f where f.follower_id = p_viewer and f.followee_id = po.author_id and f.status = 'accepted')
      when 'author' then po.author_id = p_author
      when 'saved' then exists (select 1 from public.post_saves s where s.user_id = p_viewer and s.post_id = po.id)
      else false end
  order by po.created_at desc, po.id desc
  -- One extra row tells the client whether another page exists.
  limit public._page_size(p_limit) + 1
$$;

create function public.feed_page(p_feed text, p_limit int default 15, p_cursor text default null)
returns table (
  post_id uuid, author_id uuid, author_name text, author_photo_path text, caption text, audience text,
  created_at timestamptz, media_path text, media_type text, like_count int, comment_count int,
  liked_by_me boolean, saved_by_me boolean, is_mine boolean, page_cursor text
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
  liked_by_me boolean, saved_by_me boolean, is_mine boolean, page_cursor text
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
  liked_by_me boolean, saved_by_me boolean, is_mine boolean, page_cursor text
) language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  return query select * from public._post_rows(u, 'saved', null, p_limit, p_cursor);
end $$;

-- Oldest first, so a thread reads top to bottom and "load more" appends.
create function public.comments_page(p_post uuid, p_limit int default 15, p_cursor text default null)
returns table (comment_id uuid, author_id uuid, author_name text, body text, created_at timestamptz,
               can_delete boolean, page_cursor text)
language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); owner_id uuid;
begin
  owner_id := public._visible_post_author(u, p_post);
  return query
    select c.id, c.author_id, pr.display_name, c.body, c.created_at,
           (c.author_id = u or owner_id = u), public._make_cursor(c.created_at, c.id)
    from public.post_comments c
    join public.profiles pr on pr.user_id = c.author_id
    where c.post_id = p_post
      and (p_cursor is null or (c.created_at, c.id) > (public._cursor_ts(p_cursor), public._cursor_id(p_cursor)))
      and not public._blocked_between(u, c.author_id)
    order by c.created_at, c.id
    limit public._page_size(p_limit) + 1;
end $$;

/* --------------------------------------------------------------- follows */

create function public.follow_user(p_user uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); vis text; cur text; st text;
begin
  if p_user is null or p_user = u then raise exception 'LOVOKI_INVALID: self_follow'; end if;
  if public._blocked_between(u, p_user) or not public._is_completed(p_user) then raise exception 'LOVOKI_NOT_FOUND'; end if;
  select status into cur from public.follows where follower_id = u and followee_id = p_user;
  if cur is not null then return cur; end if; -- idempotent: never downgrades or re-notifies
  select social_visibility into vis from public.profiles where user_id = p_user;
  st := case when vis = 'public' then 'accepted' else 'pending' end;
  insert into public.follows (follower_id, followee_id, status, accepted_at)
    values (u, p_user, st, case when st = 'accepted' then now() end);
  perform public._notify(p_user, u, case when st = 'accepted' then 'follow' else 'follow_request' end);
  return st;
end $$;

create function public.unfollow_user(p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  delete from public.follows where follower_id = u and followee_id = p_user;
  delete from public.notifications where recipient_id = p_user and actor_id = u and type in ('follow', 'follow_request');
end $$;

create function public.respond_follow_request(p_follower uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  if p_accept then
    update public.follows set status = 'accepted', accepted_at = now()
      where follower_id = p_follower and followee_id = u and status = 'pending';
    if not found then raise exception 'LOVOKI_NOT_FOUND'; end if;
    update public.notifications set read_at = coalesce(read_at, now())
      where recipient_id = u and actor_id = p_follower and type = 'follow_request';
    perform public._notify(p_follower, u, 'follow_accepted');
  else
    delete from public.follows where follower_id = p_follower and followee_id = u and status = 'pending';
    if not found then raise exception 'LOVOKI_NOT_FOUND'; end if;
    delete from public.notifications where recipient_id = u and actor_id = p_follower and type = 'follow_request';
  end if;
end $$;

create function public.remove_follower(p_follower uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  delete from public.follows where follower_id = p_follower and followee_id = u and status = 'accepted';
  delete from public.notifications where recipient_id = u and actor_id = p_follower and type in ('follow', 'follow_request');
end $$;

-- Going public accepts everyone who was waiting (they asked to follow a profile that is now open to all).
create function public.on_visibility_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  if new.social_visibility = 'public' and old.social_visibility = 'followers' then
    for r in select follower_id from public.follows where followee_id = new.user_id and status = 'pending' loop
      update public.follows set status = 'accepted', accepted_at = now()
        where followee_id = new.user_id and follower_id = r.follower_id;
      perform public._notify(r.follower_id, new.user_id, 'follow_accepted');
      update public.notifications set read_at = coalesce(read_at, now())
        where recipient_id = new.user_id and actor_id = r.follower_id and type = 'follow_request';
    end loop;
  end if;
  return new;
end $$;
create trigger profiles_visibility_change after update of social_visibility on public.profiles
  for each row execute function public.on_visibility_change();

create function public.list_follows(p_kind text, p_limit int default 20, p_cursor text default null)
returns table (user_id uuid, display_name text, photo_path text, status text, created_at timestamptz, page_cursor text)
language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed();
begin
  if p_kind not in ('following', 'followers', 'requests') then raise exception 'LOVOKI_INVALID: kind'; end if;
  return query
    select o.uid, pr.display_name,
           (select ph.storage_path from public.profile_photos ph where ph.user_id = o.uid and ph.position = 0
              and public.can_view_content(u, o.uid, 'public')),
           o.status, o.created_at, public._make_cursor(o.created_at, o.uid)
    from (
      select f.followee_id as uid, f.status, f.created_at from public.follows f where p_kind = 'following' and f.follower_id = u
      union all
      select f.follower_id, f.status, f.created_at from public.follows f where p_kind = 'followers' and f.followee_id = u and f.status = 'accepted'
      union all
      select f.follower_id, f.status, f.created_at from public.follows f where p_kind = 'requests' and f.followee_id = u and f.status = 'pending'
    ) o
    join public.profiles pr on pr.user_id = o.uid
    where (p_cursor is null or (o.created_at, o.uid) < (public._cursor_ts(p_cursor), public._cursor_id(p_cursor)))
      and not public._blocked_between(u, o.uid)
    order by o.created_at desc, o.uid desc
    limit public._page_size(p_limit) + 1;
end $$;

create function public.social_counts()
returns table (following int, followers int, requests int)
language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  return query select
    (select count(*)::int from public.follows where follower_id = u and status = 'accepted'),
    (select count(*)::int from public.follows where followee_id = u and status = 'accepted'),
    (select count(*)::int from public.follows where followee_id = u and status = 'pending');
end $$;

-- Another person's profile for social surfaces. Explicit columns only: no date of birth (only age), no preferences,
-- no discoverability. A followers-only profile shows just a name to people who are not accepted followers.
create function public.social_profile(p_user uuid)
returns table (
  user_id uuid, display_name text, pronouns text, bio text, area_label text, age int, photo_path text,
  restricted boolean, is_self boolean, follow_status text, follows_me_status text,
  follower_count int, following_count int, post_count int
) language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); full_view boolean;
begin
  if p_user is null or public._blocked_between(u, p_user) or not public._is_completed(p_user) then return; end if;
  full_view := public.can_view_content(u, p_user, 'public');
  return query
    select pr.user_id, pr.display_name,
           case when full_view then pr.pronouns end, case when full_view then pr.bio end,
           case when full_view then pr.area_label end,
           case when full_view then public.age_of(pv.date_of_birth) end,
           (select ph.storage_path from public.profile_photos ph where ph.user_id = pr.user_id and ph.position = 0 and full_view),
           not full_view, pr.user_id = u,
           (select f.status from public.follows f where f.follower_id = u and f.followee_id = pr.user_id),
           (select f.status from public.follows f where f.follower_id = pr.user_id and f.followee_id = u),
           case when full_view then (select count(*)::int from public.follows f where f.followee_id = pr.user_id and f.status = 'accepted') end,
           case when full_view then (select count(*)::int from public.follows f where f.follower_id = pr.user_id and f.status = 'accepted') end,
           case when full_view then (select count(*)::int from public.posts po where po.author_id = pr.user_id and public.can_view_content(u, po.author_id, po.audience)) end
    from public.profiles pr join public.profiles_private pv on pv.user_id = pr.user_id
    where pr.user_id = p_user;
end $$;

/* ---------------------------------------------------------------- blocks */

create function public.block_user(p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  if p_user is null or p_user = u then raise exception 'LOVOKI_INVALID: self_block'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'LOVOKI_NOT_FOUND'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (u, p_user) on conflict do nothing;
  delete from public.follows where (follower_id = u and followee_id = p_user) or (follower_id = p_user and followee_id = u);
  delete from public.notifications where (recipient_id = u and actor_id = p_user) or (recipient_id = p_user and actor_id = u);
end $$;

create function public.unblock_user(p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin delete from public.blocks where blocker_id = u and blocked_id = p_user; end $$;

create function public.list_blocks()
returns table (user_id uuid, display_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  return query select b.blocked_id, coalesce(pr.display_name, 'Former member'), b.created_at
    from public.blocks b left join public.profiles pr on pr.user_id = b.blocked_id
    where b.blocker_id = u order by b.created_at desc, b.blocked_id desc;
end $$;

/* --------------------------------------------------------- notifications */

create function public.notifications_page(p_limit int default 20, p_cursor text default null)
returns table (id uuid, type text, actor_id uuid, actor_name text, post_id uuid, comment_id uuid,
               created_at timestamptz, read boolean, follow_status text, page_cursor text)
language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  return query
    select n.id, n.type, n.actor_id, coalesce(pr.display_name, 'Someone'), n.post_id, n.comment_id, n.created_at,
           n.read_at is not null,
           (select f.status from public.follows f where f.follower_id = n.actor_id and f.followee_id = u),
           public._make_cursor(n.created_at, n.id)
    from public.notifications n
    left join public.profiles pr on pr.user_id = n.actor_id
    where n.recipient_id = u
      and (p_cursor is null or (n.created_at, n.id) < (public._cursor_ts(p_cursor), public._cursor_id(p_cursor)))
      and not public._blocked_between(u, n.actor_id)
    order by n.created_at desc, n.id desc
    limit public._page_size(p_limit) + 1;
end $$;

create function public.unread_notification_count()
returns int language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := public._require_uid();
begin
  return (select count(*)::int from public.notifications n
          where n.recipient_id = u and n.read_at is null and not public._blocked_between(u, n.actor_id));
end $$;

-- p_ids null marks everything read. Ids that are not yours are ignored.
create function public.mark_notifications_read(p_ids uuid[] default null)
returns int language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_uid(); n int;
begin
  update public.notifications set read_at = now()
    where recipient_id = u and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

/* --------------------------------------------------------------- reports */

create function public.report_content(p_type text, p_target uuid, p_reason text, p_details text default '')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare u uuid := public._require_completed(); d text := btrim(coalesce(p_details, '')); ok boolean := false; rid uuid; a uuid; aud text;
begin
  if p_type not in ('post', 'comment', 'profile') then raise exception 'LOVOKI_INVALID: target_type'; end if;
  if p_reason not in ('spam', 'harassment', 'hate', 'sexual_content', 'self_harm', 'scam', 'impersonation', 'underage', 'other') then
    raise exception 'LOVOKI_INVALID: reason';
  end if;
  if char_length(d) > 500 then raise exception 'LOVOKI_INVALID: details'; end if;
  -- You can only report what you can see, and never yourself: reporting must not become a way to probe hidden content.
  if p_type = 'post' then
    select author_id, audience into a, aud from public.posts where id = p_target;
    ok := a is not null and a <> u and public.can_view_content(u, a, aud);
  elsif p_type = 'comment' then
    select c.author_id, p.author_id, p.audience into a, rid, aud
      from public.post_comments c join public.posts p on p.id = c.post_id where c.id = p_target;
    ok := a is not null and a <> u and public.can_view_content(u, rid, aud) and not public._blocked_between(u, a);
    rid := null;
  else
    ok := p_target <> u and not public._blocked_between(u, p_target) and public._is_completed(p_target);
  end if;
  if not ok then raise exception 'LOVOKI_NOT_FOUND'; end if;
  select id into rid from public.content_reports
    where reporter_id = u and target_type = p_type and target_id = p_target and status = 'open';
  if rid is not null then return rid; end if; -- already saved for review
  if (select count(*) from public.content_reports where reporter_id = u and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'LOVOKI_RATE_LIMITED';
  end if;
  insert into public.content_reports (reporter_id, target_type, target_id, reason, details)
    values (u, p_type, p_target, p_reason, d) returning id into rid;
  return rid;
end $$;

/* ---------------------------------------------------------- post-media storage */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Same recursion trap as profile photos: counting storage.objects inside a policy on storage.objects recurses.
-- The cap is SOFT under heavy parallel uploads: the check and the insert are not atomic, and an advisory lock that
-- works in plain SQL did not serialize uploads that go through the Storage API (tested: 30 parallel uploads, cap 12,
-- 15 accepted). The overshoot is bounded by the number of parallel requests. Table-level limits stay hard
-- (post_media.position = 0 and unique(post_id, position)). See docs/PHASE_3_SETUP.md.
create function public.own_post_media_object_count()
returns int language sql stable security definer set search_path = ''
as $$
  select count(*)::int from storage.objects o
  where o.bucket_id = 'post-media' and (storage.foldername(o.name))[1] = (select auth.uid())::text;
$$;

-- Audience-aware read: the object belongs to a post the caller may view (reuses can_view_content).
-- Unregistered objects (failed uploads) are readable by their owner only.
create function public.can_read_post_media(p_name text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := auth.uid(); a uuid; aud text;
begin
  if u is null then return false; end if;
  select po.author_id, po.audience into a, aud
    from public.post_media pm join public.posts po on po.id = pm.post_id where pm.storage_path = p_name;
  if a is null then return (storage.foldername(p_name))[1] = u::text; end if;
  return public.can_view_content(u, a, aud);
end $$;

create policy "post media: upload own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
    and public.own_post_media_object_count() < 60);

create policy "post media: read visible" on storage.objects for select to authenticated
  using (bucket_id = 'post-media' and public.can_read_post_media(name));

create policy "post media: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Profile photos now follow the same visibility rule (blocks, followers-only profiles, completed viewers).
-- The Phase 2 "discoverable" clause is kept so dating discovery behaviour does not change; Phase 4 owns it.
create or replace function public.can_view_photos_of(p_owner text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare u uuid := auth.uid(); o uuid;
begin
  if u is null or p_owner !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  o := p_owner::uuid;
  if public.can_view_content(u, o, 'public') then return true; end if;
  return not public._blocked_between(u, o) and exists (
    select 1 from public.profiles p join public.onboarding_state s on s.user_id = p.user_id
    where p.user_id = o and s.completed_at is not null and p.dating_discoverable);
end $$;

-- Sweep helper for operators (service role only): post-media objects that no post_media row refers to.
create function public.orphan_post_media(p_older_than interval default interval '1 day')
returns setof text language sql stable security definer set search_path = ''
as $$
  select o.name from storage.objects o
  where o.bucket_id = 'post-media' and o.created_at < now() - p_older_than
    and not exists (select 1 from public.post_media pm where pm.storage_path = o.name)
$$;

/* ---------------------------------------------------------- function grants */

do $$
declare r record;
begin
  -- Nothing in the new surface is callable by default; the allow-list below is the whole client API.
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
    '_is_completed', '_blocked_between', 'can_view_content', '_notify', '_require_completed', '_cursor_ts', '_cursor_id',
    '_make_cursor', '_page_size', '_visible_post_author', '_like_count', '_comment_count', '_post_rows', 'on_visibility_change',
    'create_post', 'delete_post', 'set_post_audience', 'like_post', 'unlike_post', 'save_post', 'unsave_post', 'add_comment',
    'delete_comment', 'feed_page', 'profile_posts_page', 'saved_posts_page', 'comments_page', 'follow_user', 'unfollow_user',
    'respond_follow_request', 'remove_follower', 'list_follows', 'social_counts', 'social_profile', 'block_user',
    'unblock_user', 'list_blocks', 'notifications_page', 'unread_notification_count', 'mark_notifications_read',
    'report_content', 'own_post_media_object_count', 'can_read_post_media', 'orphan_post_media'])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
    'create_post', 'delete_post', 'set_post_audience', 'like_post', 'unlike_post', 'save_post', 'unsave_post', 'add_comment',
    'delete_comment', 'feed_page', 'profile_posts_page', 'saved_posts_page', 'comments_page', 'follow_user', 'unfollow_user',
    'respond_follow_request', 'remove_follower', 'list_follows', 'social_counts', 'social_profile', 'block_user',
    'unblock_user', 'list_blocks', 'notifications_page', 'unread_notification_count', 'mark_notifications_read',
    'report_content'])
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
-- Storage policies run as the caller, so these two helpers must stay executable by authenticated.
grant execute on function public.own_post_media_object_count() to authenticated;
grant execute on function public.can_read_post_media(text) to authenticated;
-- can_view_photos_of was replaced above; replacing resets nothing, but state the grant explicitly.
revoke execute on function public.can_view_photos_of(text) from public, anon;
grant execute on function public.can_view_photos_of(text) to authenticated;
grant execute on function public.orphan_post_media(interval) to service_role;

commit;
