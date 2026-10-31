# Phase 4 setup: dating (discovery, likes and passes, matches, unmatch, approximate distance)

Web only. Realtime chat (Phase 5) and release prep (Phase 6) are **not** built. "Say hello" is visibly disabled with "Messaging arrives in Phase 5".

## 0. Read this first: what was invented

> **Superseded by Phase 3.5.** The minimal gender/place/visibility decisions below were replaced: the 30-city list and `save_place(label, lat, lng)` are gone (a GeoNames `places` table and `save_place_id` replaced them, stored on a ~5 km grid), gender is chosen in onboarding, and per-field audiences exist. See `docs/PHASE_3_5_NOTES.md`. This section is kept as history.

The Phase 4 brief assumed a finished "Phase 3.5" (gender, rounded place coordinates, P/M field visibility). **This repository had none of it**, so a minimal version was built inside the Phase 4 migration. Everything below marked *invented* is a decision for you to review:

| Invented | Decision |
|---|---|
| Gender | `profiles.gender` in `woman | man | non-binary`, mapped to the existing "interested in" choices (women, men, non-binary people). Required to use Discover; not required to finish onboarding (existing accounts predate it). |
| Place | A curated list of 30 cities in `packages/core/src/dating.ts` (`PLACE_CHOICES`). No geocoding service, **never device location**. The server rounds to 2 decimals (about 1 km) in `profile_places`, which only the owner can read. |
| Distance maths | A documented haversine function in SQL on the rounded places. No PostGIS. |
| Display flags | `show_gender` (hides only the label, not matching) and `show_distance` (hides your distance and exempts you from distance filtering). |
| P/M visibility | Everyone sees the same card (name, age, gender if shown, area label, distance range if shown, intention, interests, prompts, photos, bio). **Matches additionally see pronouns and the match date.** That is a thin split; widen it in `_dating_cards()` if you want more. |
| Soft filters | `dating_preferences.filter_intentions` and `filter_interests`. |
| Dating is opt-in | `dating_discoverable` has always defaulted to off, so a new account is invisible and cannot browse until it turns on "Show me in Discover". |

## 1. Setup

Same local stack as Phase 3 (`docs/PHASE_3_SETUP.md` section 1 to 2), then:

```sh
npx supabase db reset          # applies all three migrations to the LOCAL database
npm run db:types               # regenerates apps/web/src/data/database.types.ts
```

Optional: people to browse on your local stack (clearly fake, adults only, local only):

```sh
npx supabase status -o env > scripts/.seed.env     # local keys, git-ignored. Never commit or paste this file.
node scripts/seed-local-users.mjs 20                # creates seed-person-N@lovoki-seed.test, password printed at the end
node scripts/seed-local-users.mjs --remove          # deletes them again
```

The script refuses any non-localhost URL. **Do not run it against your hosted project**; create real test accounts there instead.

**Hosted development project:** nothing has been pushed. When you want that: `npx supabase link --project-ref <DEV-REF>`, `npx supabase db push --dry-run`, review it, and say "go". Migration `20261103000000_phase4_dating.sql` drops the Phase 2 view `discoverable_profiles` (see section 3) and replaces `block_user`, `can_view_content` and `can_view_photos_of`.

## 2. Commands

```sh
npm run typecheck && npm run lint && npm test && npm run build      # unit + MOCKED tests
npm run test:integration                                             # REAL local stack: all phases
python scripts/mutation-check.py                                     # manual mutation checks (loosens a rule, expects failures, restores)
npm run dev:uitest &  python scripts/dating-e2e.py                   # dating UI on fakes, incl. layout matrix
python scripts/real-e2e-dating.py                                    # dating UI on the REAL local stack, several people
```
The earlier suites (`demo-e2e.py`, `ui-e2e.py`, `social-e2e.py`, `real-e2e.py`) must stay green.

## 3. What the database enforces (migration `20261103000000_phase4_dating.sql`)

- Every new table has RLS on. Clients have **no privilege** on `dating_actions`, `matches`, `dating_exclusions`, `dating_rate`; only your own `profile_places` row is readable. Everything goes through `SECURITY DEFINER` functions using `auth.uid()`.
- **One eligibility rule**, `_dating_eligible(viewer, target)`, plugged into the single shared `can_view_content(viewer, author, 'dating')`, which the profile-photo storage policy calls. It requires: both onboarding-complete, both adults (re-checked in the function), both discoverable, no block either way, no exclusion, not currently matched, genders wanted both ways, ages in each other's ranges, and the viewer's max distance. Unknown audiences now return false.
- **Likes are private.** No function or table reveals who liked you, there is no "likes you" list and no "someone liked you" notification. Only a **match** is announced, to both. Liking someone ineligible, paused, unknown or incompatible returns the same `{matched:false}` as liking an eligible person.
- `like_profile` takes a per-pair advisory lock, so two simultaneous opposite likes create exactly one match (proved by an integration test, and by a mutation that removes the lock).
- `pass_profile` hides someone for 90 days and notifies nobody. A pass never downgrades a like.
- **Pause** (`dating_discoverable = false`): you vanish from everyone's discovery at once; you cannot like or discover; existing matches stay; nobody can newly match you. Likes sent to you while paused are stored but inert. **Resuming** makes stored mutual likes live: pairs become matches then, and both are told. (A trigger does this.)
- **Unmatch** (either person) and a **social block** both end the match and add a permanent exclusion, so neither appears in the other's Matches or Discover. Unblocking does **not** restore discovery (a design choice).
- **Discovery order**: `md5(viewer:day:candidate)` then id, i.e. a per-viewer shuffle that changes daily. Keyset cursor `day|hash|id`, page 10 to 20, stable while people are liked, passed or added, no OFFSET. Malformed or out-of-window cursors are rejected; a forged valid cursor can only move the window. No engagement ranking, no boosts, no popularity.
- **Distance** is a bucket (`<5`, `<10`, `<25`, `<50`, `<100`, `100+` km) and never a number or coordinates. The viewer's max distance is rounded **up** to a bucket edge. People with no place, or who hide distance, are not distance-filtered.
- **Limits** (named, one function each): `_limit_daily_likes()` 50 per rolling 24 h; `_limit_discover_hourly()` 120 `discover_profiles` calls per clock hour; `_pass_days()` 90.

### Flaws and limits found (read these)
- **Inert-like inference.** After a person resumes, a match can appear for someone who liked them while they were paused. That only reveals a *mutual* like, which a match always does, but the timing can tell the other person "they were paused". Accepted.
- **Distance is probe-able at bucket grain.** Someone with several accounts at known places can narrow a target's position to the intersection of bucket rings (5 km minimum ring). The 2-decimal rounding and the bucket rounding of the filter limit this; it is not eliminated. The distance privacy note below says so plainly.
- **Cost.** `_dating_eligible` runs once per candidate row (about ten small lookups). It is fine at test scale; at real scale it needs a precomputed candidate table. Not done.
- **Exclusion is forever**, including after an unblock. There is no "undo unmatch".
- **Hidden gender label vs matching.** `show_gender = false` hides the label but you are still matched by gender; a viewer who only wants one gender can infer yours. Documented in the UI.
- The Phase 2 view `discoverable_profiles` listed every discoverable person to any signed-in user and ignored compatibility, so it is **dropped**.
- The storage object caps are still soft under parallel uploads (see Phase 3 notes).

## 4. Privacy note on distance

LOVOKI never asks for your device location. You pick a city from a list; the server rounds it to about 1 km and only you can read it. Other people only ever see a range such as "less than 25 km away", never a number, and never coordinates. Ranges can still be combined: if someone makes many accounts in different known places and watches which ranges you fall into, they can narrow down where you are. If that matters to you, turn off "Show my distance range to others" in Settings: nobody sees a range for you and distance filters don't apply to you.

## 5. What each automated check proves, and does not

| Check | Kind | Proves | Does **not** prove |
|---|---|---|---|
| `npm test` (core unit, mocked fakes, static SQL) | unit / **mocked** | helpers, reducers, cursors, buckets, the fake's contract, SQL text conventions (no client write grants, named limits once) | any database or storage behaviour |
| `npm run test:integration` | **integration**, local stack | the compatibility matrix, mutual age ranges, distance buckets and rounding, every exclusion, adult re-check (with the trigger bypassed locally), like idempotency, the race, no endpoint reveals likes, cursor stability and tampering, rate limit and daily cap, unmatch/block/pause effects, photo policy, direct writes denied, a JSON key scan of every dating response | hosted project config, email delivery to real inboxes |
| `python scripts/mutation-check.py` | **manual** mutation | loosening gender, exclusions, pause, age, distance or the pair lock makes the dating tests fail (the under-18 re-check is an *equivalent mutant*: the age-range check constraint already excludes minors, so no test can distinguish it) | that every possible bug is caught |
| `dating-e2e.py` | browser on **fakes** | screens, optimistic like/pass with rollback, keyboard, match dialog, filters, empty/paused/limit states, layout at 390/768/1440 light and dark, 44px targets at 390 | Supabase |
| `real-e2e-dating.py` | browser on the **real local stack** | sign-up mail, UI onboarding, settings, the deck from real RLS, real signed-URL photos, a private first like, the second liker's match dialog, the first liker seeing the match on focus, unmatch, the filter applied by the database, pause, report, logout, no forbidden keys on the wire | hosted email, other browsers, load |

## 6. Manual checklist (hosted development project, after you say "go")
1. Create two real test accounts A and B. Set gender and city in Settings for both; turn on "Show me in Discover".
2. Each wants the other's gender and ages overlap: both appear in each other's Discover with a distance range, never a number.
3. A likes B: B sees nothing new. B likes A: B gets the match dialog; A sees the badge on focus, the notification and the Matches row.
4. Unmatch from either side: both lists empty, neither in the other's Discover.
5. Pause A: A is gone from B's Discover at once; A's Discover shows the paused state.
6. Settings: remove your city: distance disappears from your card and the distance filter is disabled.
7. Block B from a card: the card goes; B cannot see A's profile.
8. Check on the Network tab that no response contains coordinates, a birth date, or any "liked you" field.
