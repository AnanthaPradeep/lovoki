# LOVOKI (web)

Dating and social discovery prototype. **Phase 1:** design system and a complete demo on sample data. **Phase 2:** real sign-up and login, resumable onboarding, persisted profile, private photos (Supabase). **Phase 3:** posts with photos, feed (Following/Explore), likes, saves, comments, follows and requests, notifications, reports and blocking (see `docs/PHASE_3_SETUP.md`). **Phase 4:** dating on real data: Discover, private likes and passes, mutual matches, unmatch, pause, approximate distance (see `docs/PHASE_4_SETUP.md`). Chat is still demo-only. Native mobile is not started.

## Requirements
Node 20+ (tested on 22), npm 10+. Demo mode needs nothing else. Real mode needs a Supabase **development** project (see `docs/PHASE_2_SETUP.md`).

## Run
```sh
npm install
npm run dev:demo        # sample data on http://127.0.0.1:5175 (no Supabase)
npm run web             # the mode in apps/web/.env.local, default demo, http://localhost:5173
```
Real mode: copy `apps/web/.env.example` to `apps/web/.env.local`, set `VITE_LOVOKI_MODE=supabase` plus the URL and **anon** key, apply the migration to a development project, and follow `docs/PHASE_2_SETUP.md`. A broken real-mode configuration shows an error screen. It never silently becomes demo.

## Commands
```sh
npm run typecheck       # tokens, core, web
npm run lint            # ESLint (typescript-eslint, react-hooks)
npm test                # unit + MOCKED tests (logic, fakes, static SQL checks)
npm run build           # typecheck + production build -> apps/web/dist
npm run check           # all of the above
npm run test:integration # REAL local Supabase stack (Docker + `npx supabase start`): RLS, storage, auth, adapters
npm run test:db         # legacy Phase 2 SQL tests on stubbed schemas (superseded by test:integration)
npm run build:single -w @lovoki/web   # one self-contained demo HTML file (hash URLs)
```
Browser tests (Python + Playwright: `pip install playwright && playwright install chromium`):
```sh
npm run dev:demo   &   npm run e2e:demo      # 31 demo checks
npm run dev:uitest &   npm run e2e:real-ui   # 49 real-mode UI checks, driven by in-memory fakes
python scripts/social-e2e.py                 # Phase 3 screens on fakes + layout matrix
python scripts/dating-e2e.py                 # Phase 4 screens on fakes + layout matrix
python scripts/real-e2e.py                   # real-mode UI against the LOCAL Supabase stack (Phase 3)
python scripts/real-e2e-dating.py            # Phase 4 against the LOCAL stack with several people
python scripts/mutation-check.py             # manual mutation checks of the dating rules (local DB only)
node scripts/seed-local-users.mjs 20         # optional: fake adults for a local Discover (see docs/PHASE_4_SETUP.md)
```
`vite --mode uitest` is development-only. It swaps Supabase for in-memory fakes so the real-mode screens can be driven in a browser. It is removed from production bundles.

## Structure
```
packages/tokens   colours (light/dark semantic roles), type, space, radius, elevation, motion -> CSS variables
packages/core     domain types, validation, age maths, auth error mapping, redirect safety, route-guard rules,
                  photo rules, config safety, ports (AuthApi, AccountApi), demo store, in-memory fakes
apps/web          React 19 + TypeScript + Vite
  src/screens     demo screens (Phase 1), auth/, onboarding/, real/ (Phase 2)
  src/data        Supabase adapters (the only place that imports supabase-js)
  src/auth, account, routes   providers and the route gate
supabase/         migrations/ (schema, RLS, functions, views, storage) and tests/ (local Postgres suite)
docs/             PHASE_2_SETUP.md, screenshots/
```
Screens depend on the ports in `@lovoki/core`, never on the SDK. Swapping the backend means writing another adapter.

## What is real, what is demo
| | Demo mode | Real mode |
|---|---|---|
| Sign-up, login, reset, logout, session restore | n/a | Real (Supabase Auth) |
| Onboarding, profile editing, privacy settings | n/a | Real (Postgres, RLS) |
| Profile photos | n/a | Real (private Storage) |
| Feed, posts, likes, saves, comments, follows, notifications, reports, blocks | Sample data, local only | Real (Postgres, RLS, private Storage) |
| Discover, likes and passes, matches, unmatch, pause, filters, approximate distance | Sample data, local only | Real (Postgres, RLS, private Storage) |
| Chat | Sample data, local only | Not built: an honest Phase 5 screen |
| Verification, account deletion | Demo labels only | Not built |

Demo people are fictional adults with generated artwork. Nothing in demo mode is sent anywhere.

## Verification status
See `docs/PHASE_2_SETUP.md` section 10, `docs/PHASE_4_SETUP.md` section 5 and `docs/PHASE_3_SETUP.md` section 5 (what each test proves). Phase 3 database rules and the Supabase adapter are covered by integration tests on a local Supabase stack. In short, for Phase 2: the logic, the database rules (on a real Postgres engine with stubbed Supabase schemas) and the real-mode UI (with fakes) are tested. **The Supabase adapters, email delivery, callbacks and Storage API have not been run against a live project.** Section 9 of the guide is the manual checklist.
