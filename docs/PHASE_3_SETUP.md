# Phase 3 setup: social features (feed, posts, follows, notifications, reports, blocks)

Phase 3 adds a social layer on top of Phase 2. Web only. Matching/Discover (Phase 4), realtime chat (Phase 5) and release prep (Phase 6) are **not** built.

## 1. What you need installed

| Tool | Why | Check |
|---|---|---|
| Docker Desktop (running) | the local Supabase stack | `docker info` |
| Node 20+ (22 recommended) | app and tests | `node -v` |
| Supabase CLI | installed by `npm install` (dev dependency), run as `npx supabase ...` | `npx supabase --version` |
| Python 3 + `pip install playwright pillow` + `python -m playwright install chromium` | browser suites | `python -c "import playwright"` |
| bash (Git Bash) | only for the legacy `npm run test:db` | `bash --version` |

Other local Supabase projects on the same machine may already own ports 54321/54322. This repo's `supabase/config.toml` uses **544xx** ports (API 54421, DB 54422, mail 54424) so it can run beside them.

## 2. Start the local stack and apply the migrations

```sh
npm install
npx supabase start -x studio,imgproxy,edge-runtime,vector,logflare   # or: npm run db:start
npx supabase db reset                                                # applies supabase/migrations/*.sql to the LOCAL database
npm run db:types                                                     # regenerates apps/web/src/data/database.types.ts
```

Never run `db push` or `db reset --linked` against a project you cannot identify. The test harness refuses any non-local API URL.

To use the app against the local stack, create `apps/web/.env.local`:

```
VITE_LOVOKI_MODE=supabase
VITE_SUPABASE_URL=http://127.0.0.1:54421
VITE_SUPABASE_ANON_KEY=<the ANON_KEY from `npx supabase status`>
```

Only the anon key goes in the app. For a hosted **development** project, push the two migrations with `supabase link` and `supabase db push --dry-run` first, and add the Phase 2 redirect URLs.

## 3. Commands

```sh
npm run typecheck && npm run lint && npm test && npm run build     # unit + MOCKED tests
npm run test:integration                                            # REAL stack: GoTrue, PostgREST, Storage, RLS
npm run dev:demo      &  python scripts/demo-e2e.py                 # demo suite (port 5175)
npm run dev:uitest    &  python scripts/ui-e2e.py                   # real-mode UI on fakes (port 5174), Phase 2 screens
                         python scripts/social-e2e.py               # real-mode UI on fakes, Phase 3 screens + layout matrix
python scripts/real-e2e.py                                          # real-mode UI on the REAL local stack (starts its own server on 5173)
```

## 4. What the database enforces (migration `20261102000000_phase3_social.sql`)

- Every new table has RLS on and **no client write privilege**. Writes go through `SECURITY DEFINER` functions that use `auth.uid()`.
- `posts`, `post_media`, `post_likes`, `post_comments` have **no client read path**: they are read only through page functions (`feed_page`, `profile_posts_page`, `saved_posts_page`, `comments_page`). Own-row reads exist for `notifications`, `post_saves`, `content_reports`, `blocks`, `follows`.
- **One visibility rule**: `can_view_content(viewer, author, audience)`. Feeds, comments, likes, saves, reports, the post-media storage policy and profile photos all call it. Phase 4 extends this function.
  - Not visible unless both people have completed onboarding. Blocks hide both ways. The author always sees their own content.
  - A followers-only **profile** makes all its posts followers-only. Followers-only content needs an **accepted** follow; pending requests grant nothing.
- Explore = public posts from public completed profiles. Following = accepted follows plus own posts.
- Following a public profile is accepted at once; a followers-only profile gets a request the owner accepts or declines. No self-follow, status cannot be set by the client.
- Profile public to followers-only: accepted followers keep access, strangers lose it. Followers-only to public: pending requests become accepted. Post audience public to followers: engagement stays attached, but every read path re-checks visibility.
- Notifications are created only by the server (like, comment, follow, request, accepted): no self-notifications, at most one like notification per person per post, one per follow event type per pair.
- Reports: through `report_content`, idempotent per target, 10 new reports per hour per reporter, reporters read only their own. UI copy says "saved for review". There is no admin UI.
- Pagination is keyset on `(created_at, id)` with an opaque cursor, 10 to 20 rows (15 default), no OFFSET. Malformed cursors are rejected. A forged valid cursor can only move the window, never reveal hidden rows.
- Counts are computed from the like and comment tables at read time, so concurrent likes cannot drift.
- Bucket `post-media`: private, JPEG/PNG/WebP, 5 MB, path `<uid>/<post-uuid>/<uuid>.<ext>`, read policy reuses `can_view_content`, owner-only upload and delete, no overwrite, 60 objects per user.

### Known limits
- **The storage object caps are soft under heavy parallel uploads** (30 parallel uploads against a cap of 12 let 15 through; an advisory lock that worked in plain SQL did not serialize uploads through the Storage API). Table limits stay hard: 6 profile photos, one image per post.
- Image bytes are not scanned server side (same as Phase 2). The browser sniffs magic bytes and re-encodes to JPEG.
- No rate limit on posts, likes or comments (only reports are throttled).
- Notifications refresh on page focus and navigation. Realtime is Phase 5.
- Like and comment notifications link to your own posts list; there is no single-post page.
- Blocked or removed people's cached signed image URLs keep working until they expire (about 50 min cache, 60 min URL).
- Orphan sweep: a failed upload or failed file removal leaves an unregistered object that only its owner can read. The client removes its own object on failed `create_post`. Operators can list stragglers with the service role: `select * from public.orphan_post_media('1 day')` and delete them through the Storage API (deleting `storage.objects` rows directly would leave the files behind).

## 5. What each automated check proves, and does not

| Check | Kind | Proves | Does **not** prove |
|---|---|---|---|
| `npm test` (core unit, mocked flows, static SQL text) | unit / **mocked** | pure logic, reducers, cursors, validation, the fake's contract, SQL text conventions | any database, storage or email behaviour |
| `npm run test:integration` | **integration**, real local stack | RLS isolation, direct-write denial, visibility matrix, follow flow, counters under concurrency, pagination, cursor tampering, notifications, reports, blocks, post-media policies, cascades, the Supabase adapter | hosted-project config, email delivery to real inboxes, browser behaviour |
| `scripts/demo-e2e.py` | browser, sample data | Phase 1 demo behaviour | anything real |
| `scripts/ui-e2e.py`, `scripts/social-e2e.py` | browser on **fakes** | screens, states, optimistic UI, layout at 390/768/1440 light and dark, 44px targets at 390, reduced motion | Supabase |
| `scripts/real-e2e.py` | browser on the **real local stack** | sign-up mail via Mailpit and confirmation link, onboarding uploads, signed-URL images, persisted likes/comments/saves/follows/posts, notifications for a second person, block/report, logout | hosted email, other browsers, high load |

Mutation checks were run by hand while writing the tests (granting a forbidden privilege, weakening `can_view_content`); the suite failed as it should. They are not automated.

## 6. Manual checklist (hosted development project)
1. Apply both migrations to a project you created for development. Confirm Auth settings from `PHASE_2_SETUP.md`.
2. Two accounts A and B. A posts public and followers-only posts with images. B (stranger) sees only the public one in Explore and cannot open the followers-only image URL.
3. B follows A (public profile): accepted. Switch A to followers-only: a new account C gets "Request to follow" and sees nothing until A accepts.
4. B likes and comments; A sees the badge on focus. Open Notifications; the badge clears.
5. A blocks B: B's posts vanish for A and A's for B, B cannot follow. Unblock in Settings.
6. Report a post: toast says "Report saved for review." Check the row in `content_reports`.
7. Delete a post: image no longer loads, comments and notifications are gone.
8. Log out: every social route redirects to login.
