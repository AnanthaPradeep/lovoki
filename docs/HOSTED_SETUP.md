# Hosted Supabase setup (development project)

This is the checklist for pointing LOVOKI at a **hosted Supabase development project**. Nothing here has been run against the hosted project by the assistant: pushing the schema, changing dashboard settings and creating accounts are steps for you, and each is marked.

> **Is the project a development project with no real user data?** The assistant asked this twice and never got a clear "yes", so every action that writes to the hosted project is on hold. If it holds real users or data, stop: this repository's migrations were written for an empty development project.

Project: `ywdrjwizhbatprbuwplz` (`https://ywdrjwizhbatprbuwplz.supabase.co`).

## 0. Keys: what goes where

| Value | Where | Notes |
|---|---|---|
| Project URL | `apps/web/.env.local` as `VITE_SUPABASE_URL` | public |
| **Publishable** key `sb_publishable_...` | `apps/web/.env.local` as `VITE_SUPABASE_PUBLISHABLE_KEY` | public by design; row-level security is what protects data |
| Legacy `anon` JWT | `VITE_SUPABASE_ANON_KEY` (still accepted) | if both are set, the publishable one wins |
| **Secret** key `sb_secret_...` / `service_role` | **nowhere in this repo, ever** | the app refuses to start if one is placed in a `VITE_` variable |
| CAPTCHA **site** key | `VITE_CAPTCHA_SITE_KEY` | public |
| CAPTCHA **secret** key | Supabase dashboard only | never in `.env` |

`apps/web/.env.local` is git-ignored. Verified by the assistant: the publishable key is not in any tracked file or in git history (`git log -S` and a tree search both came back clean).

### Switching between local and hosted
Local stack (Docker): `VITE_SUPABASE_URL=http://127.0.0.1:54421` plus the local publishable key from `npx supabase status`. Hosted: the two values above. Edit `apps/web/.env.local`, stop and restart `npm run web` (Vite reads env at start). The auth redirect allow-list is per project, so use the origin that project lists (`http://localhost:5173` for hosted, below). A wrong value shows a configuration error screen; it never silently falls back to demo data.

## 1. Link and push the schema (you run these)

In **your own terminal** (the assistant cannot complete a browser login):

```sh
npx supabase login
npx supabase link --project-ref ywdrjwizhbatprbuwplz
npx supabase db push --dry-run     # shows exactly which migrations would run; changes nothing
```

Send the dry-run output to the assistant (or read it yourself). Expected: the Phase 2 to 4 migrations plus the two Phase 3.5 ones (`20261104000000_phase35_identity_profile.sql`, `20261104000100_places_seed.sql`, about 6,300 cities). Only after you read it and say **go**:

```sh
npx supabase db push
npx supabase migration list        # local and remote columns must match
```

The assistant does not run `db push` without your explicit "go".

## 2. Dashboard settings (Authentication)

Do these in the Supabase dashboard of the hosted project. The assistant cannot see or change them.

1. **URL Configuration**
   - Site URL: `http://localhost:5173`
   - Redirect URLs (all three):
     - `http://localhost:5173/auth/callback**`
     - `http://127.0.0.1:5173/auth/callback**`
     - `http://localhost:4173/auth/callback**`
     - `http://localhost:9710/auth/callback**` (the app's own dev port, set in `apps/web/vite.config.ts`)
   - The trailing `**` matters: the app appends `?next=...` to the callback, and a pattern without the wildcard rejects it. Verify by signing up (section 5): the confirmation mail's link must end on `/auth/callback?next=%2Fonboarding`, not on the Site URL.
2. **Sign In / Providers > Email**: *Confirm email* **ON** (the app assumes it; the remote smoke script fails if it is off). *Secure email change* ON (default): changing email then needs a click in **both** the old and the new inbox, and the Settings screen says so.
3. **Password**: minimum length **10** (matches the app's check), and **Prevent use of leaked passwords** ON where your plan offers it (Authentication > Attack Protection or Sign In / Providers > Password).
4. **SMTP** (Authentication > Emails > SMTP Settings): the built-in mailer is for tests only and is heavily rate-limited. Use custom SMTP (Brevo or Resend):
   - Create the account, add and **verify your sending domain**, publish the **SPF** and **DKIM** DNS records they give you (and DMARC if you can).
   - Paste host, port, user and key into the dashboard. Sender address must be on the verified domain.
   - Set a sensible **rate limit** (Authentication > Rate Limits: emails per hour) so a script cannot spend your sending quota.
5. **CAPTCHA** (Authentication > Attack Protection): enable *Cloudflare Turnstile*, paste the **secret** key there, and put the matching **site** key in `VITE_CAPTCHA_SITE_KEY`. With the site key absent the app shows no widget and requires nothing; with it present, sign-up and password reset require a solved check and send its token. Test both states.
6. **Development-only alternative** while you set up SMTP: you may turn *Confirm email* **OFF** on a throwaway project so sign-ups need no mail. This weakens the flow the app was built around (accounts are usable at once) and `scripts/remote-smoke.mjs` will report it. Turn it back ON before anyone else uses the project.
7. **Storage**: after the push, check **Storage > Buckets**: `profile-photos` and `post-media` exist and are **not** public. (`scripts/remote-smoke.mjs` checks this anonymously too.)

## 3. Run the anonymous smoke test (safe)

```sh
node scripts/remote-smoke.mjs
```

It reads `apps/web/.env.local`, refuses secret keys, and uses **only the publishable key without logging in**. It checks: the API exposes no tables or functions beyond two pure helpers; anonymous access to ~29 tables and ~21 functions is denied; the two storage buckets are not public and cannot be listed; nothing returns a date of birth; and it reports the auth settings the public endpoint reveals (it fails if email confirmation is off). It creates no accounts and writes nothing. On the local stack it passes 58/58. **It has not been run against the hosted project yet.**

## 4. Seed data
Do not run `scripts/seed-local-users.mjs` against hosted: it needs the service key and refuses non-local URLs.

## 5. Manual checklist (you do this in a browser; at most two throwaway accounts)

Use `http://localhost:5173` with `apps/web/.env.local` pointing at the hosted project.

- [ ] Sign up with a real inbox you own. The confirmation mail arrives; the sender is your domain (not `supabase.io`).
- [ ] The link opens the app on `/onboarding/...` (proves the redirect allow-list and `**`).
- [ ] Sign-up without ticking "I'm 18 or over" is blocked; with it ticked, Settings > Terms and email shows version `2026-11-draft-1`.
- [ ] With CAPTCHA on: the widget shows and sign-up fails until solved.
- [ ] Onboarding: username availability check works; picking a city lists GeoNames cities; photos upload and show.
- [ ] Settings > Account security: change password (wrong current is refused); change email (links to both inboxes); "Log out everywhere" signs out a second browser.
- [ ] `/@yourhandle` opens your profile; a stranger's handle that does not exist reads "isn't available".
- [ ] Forgot password mail arrives and its link opens the reset page.
- [ ] Delete the throwaway accounts afterwards in Authentication > Users.

## 6. Verified by the assistant vs only you can verify

| Verified by the assistant (local stack, mocked, or static) | Only you can verify (hosted) |
|---|---|
| Migrations apply from scratch on the local stack; 224 integration tests pass against it, including account security (change password, double-confirmed email change through Mailpit, global sign-out revoking another device) | That the same migrations apply to the hosted project (`db push --dry-run`, then `db push`) |
| Config accepts both key names and rejects secret keys (unit tests) | That your hosted dashboard settings (section 2) are actually set |
| Anonymous smoke script passes 58/58 locally | The same script against the hosted project |
| Real-browser flows (sign-up with consent, username, GeoNames city, photo upload, Discover) pass against the local stack | The same flow with real email delivery, SPF/DKIM and CAPTCHA |
| CAPTCHA present and absent (fake Turnstile in a browser) | The real Turnstile widget with your keys |

## 7. Not in scope here
Google sign-in is **not** built: the brief asked to confirm first that you want it at all. Say so if you do (it needs a Google Cloud OAuth client and an enabled provider, behind `VITE_ENABLE_GOOGLE_AUTH`).
