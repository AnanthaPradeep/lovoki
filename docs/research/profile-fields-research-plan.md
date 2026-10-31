# Profile fields: research plan

Status: **plan only.** No interviews, surveys or usability sessions have been run. Nothing below is a finding. Every "assumption" is something to test, not something known. Where this plan says "people want" or "people expect", read it as a hypothesis.

## 1. Jobs to be done

Two jobs drive the profile. They pull in different directions, which is why each field needs a visibility setting.

1. **Express myself in a way that feels like me, to the people I choose.** Social self-expression: a name and handle people can find, a photo I like, a few lines and interests that show taste, optional details (languages, work, lifestyle) I may or may not want strangers to see.
2. **Find someone compatible, safely.** Narrow a large pool to a few plausible people (age, intention, who-wants-whom, rough distance, optionally lifestyle and height), judge them from a small, honest profile, and reveal more only as trust grows (contact details only after a match), without exposing anything that could be used against me.

A field belongs in the product only if it serves one of these jobs *and* the risk of collecting it is justified. Fields that serve neither, or that carry high risk for little value, are not collected (section 4).

## 2. Field-by-field justification

"Required" means onboarding cannot finish without it. "Default audience": P anyone who can see the profile, F followers, M matches, X only me. Defaults are starting points to test, not conclusions.

| Field | Job | Why it is there | Required | Default audience | Main risk and mitigation |
|---|---|---|---|---|---|
| Username (@handle) | 1 | A stable, findable identity that is not an email or a real name; `/@handle` links | Yes | P | Impersonation, squatting: reserved words, 30-day hold on released handles, change once per 30 days |
| Display name | 1, 2 | What people call you | Yes | P | Real-name exposure is the user's choice; no verification claimed |
| Date of birth | 2 | Enforce 18+, compute age | Yes | X (only age shown) | Under-age use, leak: stored, never returned to other users; age is labelled self-declared, not verified |
| Gender (man, woman, non-binary, self-describe up to 30 chars) | 2 | Matching is by who each person wants to meet | Yes | P (label can be hidden; matching still uses it) | Exclusion, mislabelling: self-describe is free text, counts as non-binary for matching |
| Interested in | 2 | Core matching input | Yes (to appear in Discover) | Not shown as a field | None beyond gender |
| Relationship intention | 2 | Reduces mismatched expectations | Yes (to appear in Discover) | P | Pressure to over-commit; options include "figuring it out" |
| Place (a city from a list) | 2 | Distance and local relevance | Yes | P as a city; others see only a distance range | Location exposure: city list only, no free text, coordinates rounded to about 5 km, never returned to clients |
| At least one photo | 1, 2 | Judging compatibility and trust | Yes | By visibility setting | Image misuse, location in metadata: re-encoded in the browser (strips EXIF), private storage, signed URLs |
| Avatar crop | 1 | Small round picture in feeds | No | As the photo | None |
| Bio, pronouns, prompts, interests | 1, 2 | Taste and conversation starters | No | P | Over-sharing: length limits, visible preview before saving |
| Instagram handle | 1 | Optional link out | No | **M** | Stalking: only to matches by default |
| Height | 2 | Common soft preference, also self-expression | No | P | Shaming, pressure: optional, can be hidden, soft filter only |
| Job title, company or school | 1, 2 | Conversation topic, trust | No | **M** | Workplace identification: owner picks audience; free text capped |
| Education level | 2 | Compatibility signal for some | No | P | Class signalling: optional, "prefer not to say" |
| Languages (ISO 639-1, includes Tamil, Malayalam, Hindi, Telugu, Kannada, English) | 2 | Whether we can talk easily | No | P | Low |
| Lifestyle: drinking, smoking, exercise, diet, pets | 2 | Day-to-day compatibility; diet includes vegetarian, eggetarian, vegan, non-vegetarian | No | P | Judgement: optional, "prefer not to say" |
| Kids (has, wants) | 2 | A common deal-breaker worth knowing early | No | P | Pressure: optional |
| Relationship structure | 2 | Honest expectations | No | P | Stigma: optional, can be hidden |
| Religion | 1, 2 | Meaningful to some, **sensitive** | No, explicit opt-in | **X** | Discrimination, harm if exposed: off unless opted in, display-only, never a filter, never ranked, never used for ads |
| Social settings (who can comment, show follower counts) | 1 | Control over interaction | No | n/a | None |
| Dating settings (discoverable, show distance range) | 2 | Control over visibility | Discoverable defaults to off | n/a | None |
| Soft filters (height range, drinking, smoking, kids) | 2 | Narrow your own queue | No | Never shown to others | Discrimination by filter: affects only your own queue; religion has no filter |
| Marketing email consent | none | Separate, optional | No | n/a | Dark patterns: separate box, **off by default** |

## 3. Interview guide (8 questions)

Run semi-structured, 30 to 40 minutes, with adults who have used a dating or social app in the last year. Ask for stories about real past behaviour, not preferences in the abstract.

1. Tell me about the last time you set up a profile on an app. What did you fill in first, and what did you skip? Why?
2. When you look at someone's profile, what do you look for first? What makes you decide quickly yes or no?
3. Think of a time you felt uncomfortable about something you had put on a profile, or something you saw on someone else's. What happened?
4. Which details would you only want to share after you had talked to someone? What would you never put on a profile?
5. How do you decide between showing something to everyone, to people you follow, or only to a match? Walk me through one example.
6. Tell me about the last time you wanted to filter people out. What did you want to filter on, and how did it feel to do it?
7. How do you feel about an app knowing roughly where you are? What would make you comfortable or not?
8. If an app asked for a sensitive detail such as religion, what would it have to say or do before you would answer? When would you say no?

## 4. Usability task script (5 participants)

Prototype: the local app on a phone-sized window and a desktop window. Think-aloud. Record success, time, errors and quotes; do not coach.

1. **Sign up and choose a username.** "Create an account and pick a handle." Watch: do they understand the consent box and the availability message?
2. **Finish setup.** "Set up your profile so someone could find you." Watch: where do they hesitate (gender, place, photos)? Do they notice the city list and the optional location button?
3. **Complete your profile.** "Make your profile say more about you, but only to people you pick." Watch: do the cards make sense; can they find and change an audience?
4. **Religion.** "Add something about your faith, if you want to." Watch: is the opt-in clear, do they notice it starts hidden?
5. **Account security.** "You lost your phone. Make sure nobody else can use your account, and change your password." Watch: can they find Log out of all devices and Change password?

Success criteria to agree beforehand, for example "4 of 5 find the audience control without help". Do not claim a result until sessions have been run.

## 5. Assumptions to test (not findings)

- People will accept a short required set (about nine fields) and ignore the rest until later.
- A city list is enough: people do not need to type their own place.
- "Matches only" is the right default for Instagram and work, and "only me" for religion.
- Showing height and lifestyle publicly by default is acceptable when each can be hidden.
- A completeness meter encourages adding optional details without making people feel obliged.
- The words "self-declared, not verified" next to age are noticed and understood.
- Per-group audience controls are understandable without a long explanation.
- Users prefer to see a distance range rather than a distance.

## 6. Never collected

Caste, income, exact address, GPS history, government ID, health information, sexual history, immigration status, biometrics. Any request to add one of these is out of scope for this product and is declined, not deferred.

## 7. Open questions for the team

Legal review of consent wording and age handling; whether to offer more gender options in the list rather than self-describe only; which regions the place list must cover first; what an appeal path looks like for blocked or reported accounts.
