# Phase 2 setup: Supabase auth, onboarding, profiles, photos

Everything in the repository is ready. **Nothing here has been run against a live Supabase project.** The checklist in section 9 is how you verify that on a development project you own.

## 1. Data modes

| `VITE_LOVOKI_MODE` | What you get | Needs Supabase |
|---|---|---|
| `demo` (default) | The Phase 1 experience: 14 synthetic people, local state, reset button | No |
| `supabase` | Real sign-up and login, onboarding, persisted profile, private photos. Feed, matching and chat are honest "later phase" screens | Yes |

- A broken `supabase` configuration shows a **configuration error screen**. It never falls back to demo data.
- The active mode is labelled in the sidebar ("Demo data", and "Supabase mode" in development).
- Demo data and a real account never share state: the two modes mount separate app roots and use separate storage keys.
- The single-file preview build (`npm run build:single -w @lovoki/web`) is always demo and uses hash URLs.

## 2. Browser configuration

```sh
cp apps/web/.env.example apps/web/.env.local
```

```
VITE_LOVOKI_MODE=supabase
VITE_SUPABASE_URL=https://<project-ref>.supabase.co     # local CLI: http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon / publishable key>
```

- Use the **anon / publishable** key only. Everything prefixed `VITE_` is public in the browser bundle.
- The app refuses to start if it sees a `service_role` or `sb_secret_` key, or any `VITE_` variable whose name contains `service_role`, `secret` or `private`.
- `.env.local` is git-ignored. Only `.env.example` (placeholders) is committed.
- Never paste a service-role key into chat, a file in this repository, or a `VITE_` variable.

## 3. Create or choose a development project

Use a **local Supabase** (Supabase CLI + Docker) or a **hosted project that you have created only for development**. Do not apply these migrations to a production or unidentified project.

Local:

```sh
supabase init            # once, if you have no supabase/config.toml
supabase start           # prints the API URL and anon key
supabase db reset        # applies supabase/migrations/*.sql to the LOCAL database
```

Hosted development project:

```sh
supabase login
supabase link --project-ref <DEV-PROJECT-REF>   # check the ref twice
supabase db push --dry-run                       # review what will run
supabase db push
```

If the signup trigger fails to create (`must be owner of relation users`), run the `create trigger on_auth_user_created ...` statement from the migration in the dashboard SQL editor as the `postgres` role. The app also self-heals missing rows on first load (`ensure_account`), so a missing trigger degrades gracefully rather than breaking sign-up.

## 4. Dashboard configuration (Authentication)

| Setting | Value | Why |
|---|---|---|
| Sign In / Providers > Email | Enabled | |
| Confirm email | **On** | Sessions start only after the address is confirmed |
| Minimum password length | **10** | The browser enforces 10. Supabase's default is 6, so set it here for server-side enforcement |
| Social providers | Leave off | No social-login buttons exist in this build |
| URL Configuration > Site URL | `http://localhost:5173` (dev), your real origin later | |
| URL Configuration > Redirect URLs | see below | Email links are rejected unless their target is listed |
| Rate limits | Defaults are fine for development | The built-in mailer is very limited. Configure custom SMTP before real users |

### Callback URLs

LOVOKI sends email links to `/auth/callback` with a `?next=` query (`/onboarding` after confirmation, `/reset-password` after a reset request). Add these entries:

| Environment | Redirect URL entry |
|---|---|
| Local dev server | `http://localhost:5173/auth/callback**` and `http://127.0.0.1:5173/auth/callback**` |
| Local UI preview (`vite preview`) | `http://localhost:4173/auth/callback**` |
| Production | `https://<your-domain>/auth/callback**` |

Notes:
- The trailing `**` lets the allow-list match the `?next=...` query. **Check how your project matches wildcards** (step 9.2). If a link is rejected, add the exact URL shown in the error.
- Flow is **PKCE**. The link must be opened **in the same browser** that requested it. Opening it on another device shows a clear "this link was opened in a different browser" message with recovery options.
- Email templates can stay on Supabase's defaults (`{{ .ConfirmationURL }}`). The callback page also understands `token_hash` + `type` links if you later customize templates.

## 5. Single-page-app routing

The app uses real paths (`/me`, `/onboarding/photos`, `/auth/callback`). Your host must serve `index.html` for unknown paths:

| Host | Configuration |
|---|---|
| Vite dev and preview | Automatic |
| Netlify, Cloudflare Pages | `apps/web/public/_redirects` (included): `/*  /index.html  200` |
| Vercel | `apps/web/vercel.json` (included) |
| nginx | `location / { try_files $uri /index.html; }` |
| Apache | `FallbackResource /index.html` |

## 6. What the database enforces

Migration: `supabase/migrations/20261101000000_phase2_foundation.sql`.

- **Private data is separated.** Date of birth lives in `profiles_private`, owner-readable only. RLS cannot hide columns, so no other table holds it.
- **Clients cannot write tables.** `anon` and `authenticated` get `SELECT` on their own rows only. Every write goes through a `SECURITY DEFINER` function (`save_basics`, `save_about`, `save_preferences`, `save_privacy`, `set_onboarding_step`, `register_photo`, `reorder_photos`, `delete_photo`, `complete_onboarding`). Each uses `auth.uid()`, so one user cannot act as another.
- **Adult rule is server-side.** A trigger rejects dates of birth under 18 or implausibly old. The date locks after onboarding completes.
- **Completion is validated, not trusted.** `completed_at` can only be set by `complete_onboarding()` after it checks the stored data. The required set is: display name, date of birth (18+), what you're looking for, who you'd like to meet, a city or region, and one photo.
- **Only two cross-user read paths exist:** the views `public_profiles` and `discoverable_profiles`. They list explicit columns, expose `age` and never `date_of_birth`, and filter on completion plus `social_visibility` or `dating_discoverable`.
- **Account creation is idempotent.** A trigger on `auth.users` creates the rows, and `ensure_account()` repairs partial setups without duplicates.
- **Photos.** Private bucket `profile-photos`, 5 MB limit, JPEG/PNG/WebP only. Upload is allowed only into `<your-user-id>/<random-uuid>.(jpg|png|webp)`, at most 12 objects per user. There is no update policy, so objects cannot be overwritten. Others can read your photos only while your profile is complete and visible. `register_photo` takes type and size from the stored object's metadata, not from the client.

### Known limits of that model
- The bucket enforces the **declared** MIME type, not file contents. The browser sniffs magic bytes and re-encodes every photo as JPEG (which also strips location EXIF), but a determined client could upload other bytes with an image MIME type. Content scanning needs an Edge Function (planned for the release-preparation phase).
- The age check uses UTC on the server and the viewer's local date in the browser. The server is authoritative.
- Orphaned objects (a failed upload or a failed removal) are private and capped. The client removes stale ones on load. A scheduled server-side sweep is not included.

## 7. Distance and location

This phase never requests device location. People type a city or region. The distance preference is stored and labelled "saved for later". No distances are shown for real users, and none are invented.

## 8. Account features not implemented

Account deletion, data export, identity or photo verification, blocked accounts, notification preferences and moderation actions are not built. The settings screen says so instead of showing dead buttons.

## 9. Verify on your development project (manual)

Nothing below has been run by the author. Use two throwaway accounts, A and B.

1. **Sign-up email.** Create account A. A confirmation email arrives, and the app shows "Check your email" with a 60-second resend cooldown.
2. **Callback.** Open the link in the same browser. You land in onboarding. If the link is rejected, fix the Redirect URLs entry (section 4). Then open a fresh link in a different browser and confirm you see the "different browser" message rather than a crash.
3. **Neutral messages.** Sign up again with A's address, and request a reset for an unregistered address. The screens must read the same as for new or registered addresses.
4. **Onboarding resume.** Stop halfway, refresh, log out and in. You return to the saved step with answers kept.
5. **Adult rule.** Enter a date under 18. The browser blocks it. Then try the API directly to prove the server blocks it: `POST /rest/v1/rpc/save_basics` with a recent date of birth must return an error containing `LOVOKI_UNDER_18`.
6. **Isolation.** Using A's access token, `GET /rest/v1/profiles_private?select=*` returns only A's row. Using B's token it returns only B's. With only the anon key it returns a permission error. `PATCH /rest/v1/profiles` with either token must fail (no write privilege).
7. **Views.** B (completed, public) appears in `GET /rest/v1/public_profiles` for A, with `age` and no `date_of_birth`. Set B to followers-only and it disappears.
8. **Photos.** Upload 2 photos. Reorder, make one primary, delete one, reload. Try uploading into B's folder with A's token: expect a 403. Try a `.txt` file: the browser refuses it.
9. **Password reset.** Request a reset, open the link, set a new password, and log in with it.
10. **Logout.** After logout every protected URL redirects to login. Local storage has no `lovoki.user.*` keys.
11. **Trigger.** Create a user from the dashboard. Rows should appear in `profiles`, `profiles_private`, `dating_preferences` and `onboarding_state`.

## 10. What each automated check proves

| Check | Command | What it is | What it does **not** prove |
|---|---|---|---|
| Unit and logic tests (188) | `npm test` | Age boundaries, validation, auth error mapping, redirect safety, route-guard table, onboarding resume, retry, logout cleanup, photo rules, config safety. Includes **mocked** flows with in-memory fakes and **static** checks of the SQL text | Any Supabase behaviour |
| Database tests (23 blocks) | `PGHOST=localhost PGUSER=postgres bash scripts/db-test.sh` | The migration, constraints, RLS, privileges, functions, views and storage policies on a real PostgreSQL engine, with stubbed `auth` and `storage` schemas. Refuses non-local hosts and drops its throwaway database | GoTrue, the Storage HTTP API, PostgREST, email, real JWTs |
| Real-mode UI tests (49) | `npm run dev:uitest` then `npm run e2e:real-ui` | The real-mode screens, guards, forms, photo handling and layout in Chromium, driven by in-memory **fakes** (`vite --mode uitest`, never in a production bundle) | Supabase, email delivery, the adapters in `apps/web/src/data` |
| Demo UI tests (31) | `npm run dev:demo` (port 5175) then `npm run e2e:demo` | Phase 1 behaviour on sample data | |

Python with Playwright is needed for the browser scripts: `pip install playwright && playwright install chromium`.
