# LOVOKI (web)

Dating and social discovery prototype. **Phase 1:** design system and a complete demo on sample data. **Phase 2:** real sign-up and login, resumable onboarding, persisted profile, private photos (Supabase). Social feed, matching and chat are still demo-only. Native mobile is not started.

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
npm test                # 188 unit tests (logic, mocked flows, static SQL checks)
npm run build           # typecheck + production build -> apps/web/dist
npm run check           # all of the above
npm run test:db         # migration + RLS tests on a LOCAL Postgres (needs PGHOST/PGUSER; refuses remote hosts)
npm run build:single -w @lovoki/web   # one self-contained demo HTML file (hash URLs)
```
Browser tests (Python + Playwright: `pip install playwright && playwright install chromium`):
```sh
npm run dev:demo   &   npm run e2e:demo      # 31 demo checks
npm run dev:uitest &   npm run e2e:real-ui   # 49 real-mode UI checks, driven by in-memory fakes
python3 scripts/ui-e2e.py --visuals-only     # screenshots at 390/768/1440, light + dark, with overflow check
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
| Discover, matching, feed, connections, chat | Sample data, local only | Not built: honest "later phase" screens |
| Verification, account deletion, blocking | Demo labels only | Not built |

Demo people are fictional adults with generated artwork. Nothing in demo mode is sent anywhere.

## Verification status
See `docs/PHASE_2_SETUP.md` section 10. In short: the logic, the database rules (on a real Postgres engine with stubbed Supabase schemas) and the real-mode UI (with fakes) are tested. **The Supabase adapters, email delivery, callbacks and Storage API have not been run against a live project.** Section 9 of the guide is the manual checklist.
