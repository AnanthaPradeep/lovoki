# UI skill review — LOVOKI Phase 1 (web)

Evidence-based, not a self-score. "Verified" means observed in a test run or screenshot; everything else is marked.

## Skills used
No `[YOUR_UI_SKILL_PATH]` was provided; the four skills named in the request were read in full:

| Skill | Path | Status |
|---|---|---|
| ui-design-styles | /mnt/skills/plugins/ui-design-styles/SKILL.md (+ references/modern-trending.md: Minimalism, Dark Mode) | Applied |
| design-guide | /mnt/skills/plugins/11922719-…:design-guide/SKILL.md | Applied. Assumed to be the requested "zizi-skills:design-guide" — please confirm |
| frontend-design | /mnt/skills/plugins/2ca4e30e-…:frontend-design/SKILL.md | Applied |
| superdesign | /mnt/skills/plugins/5398138d-…:superdesign/SKILL.md | **Not used.** CLI installed but every command returned "Not authenticated. Run `superdesign login`" (needs your account) |

## Rules extracted → where they appear

| Rule (source) | Implementation | Evidence |
|---|---|---|
| Apply one style consistently across all components (ui-design-styles) | Single token set; every component reads CSS vars generated from `packages/tokens` | No raw hex in `apps/web/src` except the photo-pager overlay and theme-color meta |
| Dark mode: not inverted; lighter surfaces for elevation; no pure white text; separate semantic variants (ui-design-styles) | `colors.dark`: bg #1C0E19 → surface → surfaceRaised get lighter; text #FBEEE0; primary flips to milk-filled; own success/error/etc. | Dark screenshots at all 3 widths |
| Minimalism: whitespace + type carry hierarchy (ui-design-styles) | Display/body size contrast; borders only on cards and list dividers | Screenshots |
| 3-tier color: primary minority, tinted neutrals ~90%, supporting sparingly (design-guide) | Plum primary; plum-tinted milk neutrals; marigold used only for match moments (match dialog, match rings, "You matched") | Grep `--c-match` usages; match-dialog screenshot |
| WCAG AA contrast (design-guide) | Contrast function in tokens | 32 automated contrast tests pass (text, muted, subtle, on-primary, semantic pairs, focus ≥3:1) in both themes |
| Fixed status semantics; never color alone (design-guide) | Errors red + icon + text ("Not sent" + Retry); notices carry icons and text | Failed-message screenshot |
| Destructive actions always confirm (design-guide) | Block, unmatch, reset demo use `ConfirmDialog` with danger button | Interaction tests: block, unmatch, reset |
| No silent failures into empty states (design-guide) | Like/message/post/report failures surface toast or inline error with retry; composer keeps draft | Tests: "failed message shows retry", "retry delivers" |
| Body text ≥ 1rem (design-guide) | Body 16px; captions 13px reserved for metadata | Token scale |
| Verify both light and dark (design-guide) | 54 screenshots: 9 routes × 3 widths × 2 themes | `scripts/shoot.py` |
| Plan, then review plan against brief before building (frontend-design) | Plan written before code; revised away from cream + serif (listed tell) → Bricolage Grotesque + Figtree | This session's plan |
| Spend boldness in one place (frontend-design) | Prompt answer set large on a note overlapping the Discover photo; rest is quiet | Discover screenshots |
| Avoid generated-design tells: all-caps eyebrows, "A · B · C" meta, "→" on buttons, single-word headline accents (frontend-design) | None used; meta rendered as separate icon+text items | Visual review |
| Numbered markers only for real sequences (frontend-design) | None used | — |
| Motion only in response to actions; respect reduced motion (frontend-design) | Card leave on pass/like, dialog/sheet entry, toasts; global reduced-motion override | CSS; reduced-motion not tested in a browser (see below) |
| Copy: active verbs, same name through a flow, errors say what happened and what to do (frontend-design) | "Publish" → "Published…"; "Block" → "…is blocked"; "Couldn’t publish. Your post is still here, so you can try again." | Toast text in tests |
| Watch CSS specificity / ordering (frontend-design) | Found and fixed: `.rail` declared after its hiding media query, so the rail leaked onto phones | Before/after screenshots |
| Responsive, visible focus, accessible (frontend-design quality floor) | 3px focus ring; native `<dialog>` (focus trap, Esc); 44px targets; labelled icon buttons; skip link | Tests: "focus outline visible", "no horizontal overflow at 390px" |

## Intentional deviations
- **Milk background vs frontend-design's "cream background" tell:** the brief requires milk-led backgrounds and the skill says the brief wins. Mitigated by grotesque display type and no terracotta accent.
- **Superdesign canvas skipped:** blocked on login; designed directly.
- **design-guide's soft-pill status rule targets data tables;** LOVOKI has no tables, so it applies via soft `notice-*` and chip styles.
- **design-guide's render-candidates montage script (step 5):** not run (needs rsvg-convert/magick; icons come from one family, lucide, so no custom icon geometry was drawn). Photo art was judged from real screenshots instead.
- **No LEARNINGS.md** existed beside design-guide, so no recorded preferences could be checked.

## Visual checks actually performed
- Playwright Chromium, 1440×1000, 768×1024, 390×844, light and dark, all 9 routes; screenshots reviewed.
- 31 scripted interactions pass; zero page errors.
- Bugs found by these checks and fixed: rail leaking onto phones; like button below fold on 390×844 (fixed with sticky decision bar); Filters button accessible name read "Filters1"; list rows overflowing at 390px; portrait silhouette reading as a keyhole.

## Known issues / unverified
- Screen readers (VoiceOver/NVDA) not tested; only accessible names and roles were checked via Playwright.
- `prefers-reduced-motion` CSS present but not exercised in a browser run.
- Touch swipe on Discover not tested on a real device (buttons and arrow keys are tested).
- Safari/Firefox not tested; Chromium only.
- Placeholder art is generated, not photography; real photo cropping is untested.
- "Show approximate distance" is stored but has no visible effect (it governs what others would see).
- Hosted preview uses hash routes, so deep links into a route may not survive sharing; in-app navigation works.
- Native mobile not built (deferred).

---

# Phase 2 addendum: auth, onboarding, profile, photos

## Which design guidance was used
The Phase 1 skills (ui-design-styles, design-guide at `11922719-…`, frontend-design at `2ca4e30e-…`) were **not re-opened in this phase**. The design reference was the rules extracted above, the existing tokens and components, and the approved Phase 1 screenshots. Your `zizi-skills:design-guide` identifier is still unconfirmed. Superdesign was not used. No new visual direction was introduced: new screens reuse `.card`, `.field`, `.chip`, `.btn`, `.notice`, `.radio-card`, `.segmented` and the token variables, plus a small set of new classes (auth shell, stepper, photo grid, save bar) built only from tokens.

## Rules applied to the new screens
| Rule | Where | Evidence |
|---|---|---|
| Destructive or lossy actions confirm first | Remove photo, discard unsaved edits, log out of edit with changes | Browser tests: cancel keeps, confirm removes, keep/discard behave |
| No silent failures; keep the user's work | Failed save keeps edits with "Try again"; failed upload tile keeps a Retry; sign-in/up errors inline | Tests: failed save then retry, three failed-upload tiles |
| Errors say what happened and what to do; never raw backend text | `mapAuthError`, `toAccountFailure` | Unit tests incl. "never leaks raw backend text" |
| Never colour alone | Errors carry icon + text; required/failed states have text | Screenshots |
| Accessible forms | Labels on every field, `aria-invalid` + `aria-describedby`, focus moves to first invalid field, `autocomplete` for password managers, show/hide password with `aria-pressed` | Browser tests |
| Visible focus, keyboard path | Focus ring on inputs is border + ring (not outline); Tab reaches fields, Enter submits; photo reordering is buttons, not drag-only | Browser test |
| Touch targets ≥ 44px | Buttons, icon buttons, chips, switches | CSS (`--touch`), not measured per element |
| Honest empty and unfinished states | "Later phase" screens in real mode; "Not available yet" list; no demo people shown to a real account | Browser test asserts no demo names |
| Calm hierarchy, one bold moment | Welcome headline and example profile; onboarding is quiet | Screenshots |
| Layouts stay stable while images load | Fixed 4:5 photo tiles with skeletons | Screenshots |
| Toasts must not cover actions | Moved to the top after the sticky save bar collided | Found by testing |

## Visual checks performed
Chromium, 390×844, 768×1024, 1440×1000, light and dark: welcome, login, forgot password, callback error, sign-up errors, confirmation pending, every onboarding step, discover-unavailable, profile, edit, settings and the unsaved-changes dialog (18 screens × 6 combinations). Horizontal overflow checked on every one. Representative images are in `docs/screenshots/phase2/`.

Defects found and fixed by these checks: dialog buttons that submitted their parent form; toast covering the save bar; stepper label truncation; mobile bar causing 10px horizontal overflow on the review step; stale-test races from session-restore latency.

## Deviations and known issues
- Photo upload shows per-file status (preparing, uploading, failed with retry) but no byte progress, because `supabase-js` does not expose it.
- Failed upload tiles count toward the six-photo limit until dismissed.
- Reduced motion: the global `prefers-reduced-motion` override is in `styles.css`. A browser test loads the page under that preference but does **not** assert the computed durations, so it is unverified.
- Not tested: screen readers, Safari, Firefox, real touch devices, real Supabase, or iOS/Android keyboards for the date input.
- Full-page screenshots distort sticky elements (the mobile Back/Continue bar appears mid-page). They behave correctly in a live viewport.
