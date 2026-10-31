# Phase 3.5 notes: identity, profile data, account security

Web only. Chat (Phase 5) is **not** started. The Phase 3.5 brief said to branch from "phase-3"; this repository's phase-4 branch already held all earlier work, so `phase-3b` was cut from it.

## What changed
- **Usernames**: citext handle (3 to 30 of `a-z 0-9 . _`, no leading, trailing or doubled dots, reserved words refused), rate-limited availability check, chosen in onboarding, `/@handle` profile, one change per 30 days (only after setup is complete), old handle held 30 days.
- **Consent**: sign-up sends the terms version, the 18+ confirmation and a separate marketing flag as metadata; a database trigger records them with the server clock. Finishing onboarding requires a recorded consent. Marketing is off by default and changeable in Settings.
- **Places**: a GeoNames table of 6,287 cities (population 100,000 or more; CC-BY 4.0, see `docs/ATTRIBUTION.md`). Clients search it through functions and **cannot read stored coordinates at all**. A chosen place is stored rounded to a 0.05 degree grid (about 5 km). "Use my current location" only runs after a click and only suggests nearest cities.
- **Profile model**: optional details with per-field audiences (`P` anyone who can see the profile, `F` followers, `M` matches, `X` only me) in a validated column and one server function, `_can_see_field`. Religion needs an explicit opt-in, defaults to hidden and is display-only.
- **Account security** (Settings): session info, change password (re-authenticates), change email (both inboxes confirm), log out of all devices (`scope: 'global'`).
- **Soft filters** (height range, drinking, smoking, kids) affect only the user's own Discover queue.
- **CAPTCHA** behind `VITE_CAPTCHA_SITE_KEY`; **config** accepts `VITE_SUPABASE_PUBLISHABLE_KEY`.
- **`/p/:id`** page for like and comment notifications; **`/terms`** and **`/privacy`** drafts.

## Decisions to know about
- Phase 4's minimal place model (`PLACE_CHOICES`, `save_place(text, lat, lng)`) is **superseded**; those were removed. `docs/PHASE_4_SETUP.md` section 0 describes the old model and is kept as history.
- A new account is **paused** in Discover until "Show me in Discover" is turned on. The database always defaulted to off; the test fakes used to default to on and now match.
- Required to finish onboarding (nine items): display name, username, date of birth, gender, consent, intention, interested-in, at least one photo, a place.
- Google sign-in is **not built** (the brief asked to confirm first). Terms and Privacy are drafts, not legal text.
- The bio, interests and prompts moved out of onboarding into "Complete your profile" (optional); onboarding is five steps: Basics, Preferences, Photos, Place and privacy, Review.

## Carry-overs from earlier phases
- **Storage object caps stay soft, on purpose.** The per-user object cap (12) is enforced in a storage policy that counts then inserts, so parallel uploads can pass it. The hard limit is the photos table (`register_photo` and a trigger), and orphaned files are swept by the client. This is documented and covered by a test (`phase2.int.test.ts`, "KNOWN LIMITATION"), not hidden.
- **"New" chip contrast**: measured, not guessed: 5.72:1 light, 7.44:1 dark. It already meets 4.5:1, so there was nothing to fix; a test now guards it.
- **Toast overlap**: now an automated test at 390 px (it was "by eye only").
- **Another Vite server** was found listening on `[::1]:5173` from an earlier session (it serves this repository). It was **left running**; stop it yourself if you want that port free. The real-stack browser suites bind `127.0.0.1:5173`.
