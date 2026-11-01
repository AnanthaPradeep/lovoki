# Phase 4.5: Instagram-style profiles, real privacy, labelled sample content

Web only. Chat (Phase 5), release prep (Phase 6), video upload UI, stories/reels and account deletion are **not** part of this phase.
Branch `phase-4c` was cut from `phase-3b` (the brief said "phase-4b if it exists, else phase-4"; `phase-4b` does not exist and `phase-3b` is the latest finished branch, a superset of phase-4).

> **Nothing in this phase has been run against the hosted project.** The new migration (`20261105000000_phase45_profiles_privacy.sql`) and the sample seeder exist only on the local stack. Pushing it follows the same rule as before: `npx supabase db push --dry-run`, show it, wait for an explicit "go". Seeding hosted additionally needs the project ref typed twice (see `docs/SAMPLE_CONTENT.md`).

## 1. What changed

- **Profile page at `/@handle`** (yours and everyone's): avatar, `@username`, name, pronouns, bio (line breaks kept, plain text, no auto-links), compact counts (`1.2K`) that open the gated followers/following lists, Follow / Requested / Following (asks before unfollowing), a menu (copy link, report, block), and for your own profile Edit profile, Share profile, Settings. Tabs: **Posts** (3-column square thumbnail grid), **Saved** (yours only), **About**.
- **Private accounts are really private** (decision D1). A non-follower sees `@username`, name, bio, counts and a **blurred avatar**; never posts, media, thumbnails or the lists. A lock panel explains it and holds the "Request to follow" button.
- **Post viewer**: `/p/:id`. On desktop a tile opens it in a dialog over the grid (own URL, previous/next, arrow keys, focus trap, Escape); on a phone or a direct link it is a full page with Back and Next.
- **Search** (`/search`, and an icon in the Feed header): an accessible combobox, prefix match on `@handle` and any word of the display name, minimum 2 characters, private accounts shown with a lock, a rate limit, opt-out in Settings.
- **Suggested people** row for an account that follows nobody (public accounts only, same country first, then newest; labelled "Not personalised").
- **Settings**: Account type (Public / Private) with a plain explanation of what changes, "Show my profile picture to everyone", "Let people find me", hide counts, and a **Privacy overview** that states who sees what for BOTH layers (social and dating). A developer-only "Hide sample content" switch exists only with `VITE_SHOW_DEV_TOOLS=true`.
- **Sample content**: 30 fictional adults and about 230 posts, always labelled **Sample**, that can never reach a person. Seeder: `scripts/seed-sample-content.mjs`. Release guard: `scripts/assert-no-sample-data.mjs`.
- **Thumbnails and placeholders**: posts get a ~400 px thumbnail and a blurhash generated in the browser at upload (Supabase image transformations are not on the free plan). Avatars get a blurhash too.
- **Demo mode** has the same shape: an `@handle` line, counts and a `/@handle` route.

## 2. Decisions D1 to D5, and what each one implies

| | Decision | Implication |
|---|---|---|
| D1 | A private **social** account hides social content from non-followers. Dating photos are governed separately by "Show me in Discover". | A private account that is also discoverable still appears in Discover, with its dating photos, to people the dating rules allow. The Settings overview says this in words. |
| D2 | For non-followers of a private account the avatar is a blurred placeholder decoded from a stored blurhash; the real avatar file is never served. Owner toggle: "Show my profile picture to everyone". | The storage read rule serves that one file only when the toggle is on. Other photos stay private. A blurhash is a tiny (about 30 character) low-resolution description of the picture; that is the only thing a stranger receives. |
| D3 | Non-followers see handle, name, bio, blurred avatar and post/follower/following **counts** (hideable). | Counts come from real rows. The post count for a stranger of a private account counts all posts (their number, never their content). Hiding counts hides all three and also the lists, from everyone but the owner. |
| D4 | `post_media.kind` is `image` or `video`; policies and tests do not depend on it. | There is no video upload UI. A test flips a row to `kind = 'video'` and proves the same visibility results. |
| D5 | Sample images are generated art plus CC0 illustrated avatars. No real-person photos, no generated faces. | Details and licences in `docs/SAMPLE_CONTENT.md`. |

No decision above contradicted anything I found, so no question was asked at the start. One default needed a recommendation (below).

## 3. State transitions (tested in `tests/integration/privacy45.int.test.ts`)

| Transition | What happens |
|---|---|
| **Public to private** | Accepted followers stay. Pending requests stay pending. The profile, its posts, thumbnails and originals disappear from Explore, from search content and from non-followers' feeds immediately (every read path calls `can_view_content`). Likes and comments that people left while it was public are **retained**: followers still see the counts, people who can no longer see the post can no longer see them. |
| **Private to public** | **Pending requests are not auto-accepted.** The Phase 3 trigger did that; it was removed. *Recommendation, implemented as the safe default:* going public changes who may see your content, not who you approve as a follower. Requesters can see your public content anyway, and you decide in Requests whether to accept them. If you would rather copy Instagram and approve everyone waiting, say so and it is a four-line trigger (the mutation check keeps a copy of it). |
| **Owner removes a follower** | Access ends at once for every database read. A signed URL issued earlier stays valid until it expires (below). |
| **Block** | Follows both ways are deleted, the card and every surface disappear for the pair. |

## 4. Signed URLs and the residual risk

Private media is served through signed URLs that live **120 seconds** and are never cached by the app past 90 seconds (`SIGNED_URL_TTL_S`, `SIGNED_URL_CACHE_MS`), cleared on logout. The URL is a bearer token: **a URL issued before an unfollow, a block or a switch to private stays valid until it expires (at most 120 s).** After that it is dead, and a *new* URL is refused immediately. This is proven in the integration tests (the old URL works for 4.5 s after the follower is removed, then fails). Anyone who is allowed to see an image can also screenshot it or pass the link on within those two minutes; no web app can prevent that.

## 5. Setup

```sh
# local stack (Docker), as in earlier phases
npx supabase start
npx supabase migration up        # applies 20261105000000_phase45_profiles_privacy.sql
npm run db:types                 # regenerates apps/web/src/data/database.types.ts

# sample content (local only by default)
npx supabase status -o env > scripts/.seed.env      # git-ignored; never commit or paste it
node scripts/seed-sample-content.mjs                # prints the plan, asks, writes
node scripts/seed-sample-content.mjs --remove       # takes every sample account and file away again
node scripts/assert-no-sample-data.mjs --expect production   # must exit 1 while samples exist

# browser suites
npm run dev:uitest &                                # fakes on :5174
python scripts/profiles-e2e.py [--visuals]          # the new screens, on fakes
python scripts/real-e2e-profiles.py                 # the same screens against the real local stack
VITE_SHOW_DEV_TOOLS=true npm run dev -w @lovoki/web -- --mode uitest --port 5178 --host 127.0.0.1   # then:  python scripts/profiles-e2e.py --devtools-port=5178
```

Environment names: `VITE_SHOW_DEV_TOOLS` (developer tools; never set it in a build you ship). `app_config.environment` defaults to `development` and can only be changed by a migration. **Phase 6 must add that migration for production** (a one-line `update` with `set local lovoki.allow_config_change = 'on'`) and run `assert-no-sample-data.mjs --expect production` in the release pipeline.

## 6. What the tests prove, and what they do not

| Layer | What it proves | Limit |
|---|---|---|
| **Mocked and unit** (`npm test`, includes `phase45.test.ts`) | Pure helpers (counts, handles, blurhash shape, privacy overview text), reducers, and that the **fake** follows the documented matrix. | Says nothing about the database. |
| **Integration, local stack** (`tests/integration/privacy45.int.test.ts`, `sample-content.int.test.ts`, plus the earlier files) | The real SQL, RLS and storage rules: every viewer relationship (self, accepted follower, pending requester, stranger, blocked either way, logged out) against a public and a private account, across profile, avatar, counts, grid, post page, thumbnails, originals, feeds, Explore, search, lists, direct storage reads, signed-URL attempts and PostgREST direct reads; the transitions; the short TTL; a `video`-kind row; the sample guards; the seeder's idempotency, refusals and removal; a JSON key scan of every payload. | Local Supabase only. Not the hosted project. |
| **Mutation checks** (`scripts/mutation-check-45.py`) | Each privacy rule was loosened in the live database, one at a time, and the integration tests failed every time (results in the final report). | Covers the rules listed in the script, not every possible bug. |
| **Browser on fakes** (`profiles-e2e.py` and the earlier suites) | Screens, states, keyboard use, layout at 390/768/1440 in light and dark, 44 px targets, reduced motion. | Fakes are not evidence about the database. |
| **Browser on the real local stack** (`real-e2e-profiles.py`) | A real browser against real GoTrue, Postgres, Storage with three real users and the seeded samples. | Chromium only; local only. |

## 7. Manual hosted checklist (do nothing here without your explicit "go")

1. `npx supabase db push --dry-run` and read it. Expect exactly one new migration, `20261105000000_phase45_profiles_privacy.sql`.
2. Only after "go": `npx supabase db push`, then `npx supabase migration list` (local and remote must match).
3. Re-run `node scripts/remote-smoke.mjs` (anonymous): the new functions must all be denied to anonymous callers.
4. Check Storage: `profile-photos` and `post-media` are still private.
5. Sample content on hosted is optional and a separate decision: `docs/SAMPLE_CONTENT.md`, section "Hosted".

## 8. Known limits (stated, not hidden)

- **Avatar sizes**: one stored size plus a blurhash. Separate avatar thumbnails (about 96 and 256 px) were not built; the avatar is a normal profile photo displayed small.
- **Optional M7 (carousels up to 5 images, per-image alt text) was not built.** `post_media.position` is still limited to one image per post.
- **No video upload UI**; the schema and policies are ready for it.
- **Search is prefix search**, not fuzzy or trigram. Typing a middle part of a name finds nothing unless it starts a word.
- **The blurhash of an avatar is computed in the browser by reading the stored photo.** If the browser may not read those pixels the avatar is saved without a placeholder (a coloured initial is shown instead). It never blocks saving.
- **Chromium only.** Not looked at in Safari, Firefox or on a real device.
- **A private sample never accepts**; this is deliberate and labelled.
- **Hosted project**: untouched in this phase, as above.
