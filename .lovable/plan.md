
## Goal

Make the **candidate onboarding** and **candidate dashboard** feel like a finished, polished product — visually attractive, mobile-first, with every existing feature wired through and a couple of small functionality gaps closed. No new tables, no new dependencies.

## Part 1 — Onboarding redesign (`src/routes/_authenticated/onboarding/candidate.tsx` + `src/components/wizard/Questionnaire.tsx`)

Keep the existing 6-step branching logic (Basics → Work status → Experience/Roles → Education → Skills & languages → Preferences) and validators intact. Only redesign the shell and step UI; do not change save logic, branching, or schema.

**Wizard shell upgrade**
- Two-column desktop layout: left rail = "brand panel" (JobsKart blue gradient, illustration blob, "Your profile = your resume" headline, animated step tracker with icons per step, current-step description, trust badges); right side = form card on white. Stacks to single column on mobile with a sticky compact progress bar at the top.
- Replace the plain "Step N of 6" with a vertical stepper (desktop) / horizontal segmented bar (mobile) using Lucide icons (User, Briefcase, Building2, GraduationCap, Sparkles→Wand2, Target). Done steps get a check chip; current step glows; future steps are muted.
- Animated step transitions stay (framer-motion slide+fade already present).

**Per-step polish**
- Basics: big avatar uploader on the left (uses existing avatar field), inputs grouped in 2-col grid on md+, resume upload card moved up as a "Quick start" callout with Wand2 icon ("Skip the typing — upload your resume").
- Work status: 3 large clickable role cards (Fresher / Experienced / Student) with icons and one-line descriptions, no radio dots.
- Experience / Roles: each experience card gets a colored header strip, drag handle removed (not used), "Currently working" toggle styled as a switch. Empty state has illustration + "Add your first job" primary button.
- Education: dropdown becomes a tile grid for the most common qualifications (10th, 12th, Diploma, B.Tech, B.A., B.Com, B.Sc., MBA, Other) — clicking a tile selects it; "Other" reveals a free-text. Faster on mobile.
- Skills & languages: chips with color, AI suggestions show as a separate "✨ Suggested for you" row that fades in after typing, click-to-add. Languages get a compact row: language pill + proficiency dots (1-4).
- Preferences: salary input with ₹ prefix and "per month" suffix; work mode as multi-select pill toggles; job types same; preferred cities autocomplete chip input.

**Footer**
- Sticky bottom bar (white, top border) with Back / Save & exit / Continue. Continue button is full-width on mobile. Show a subtle "Auto-saved" tick after each successful save.

## Part 2 — Candidate dashboard redesign (`src/routes/_authenticated/candidate/dashboard.tsx`)

Same data sources. Restructure the visual hierarchy and tighten copy. All grids use min-w-0 + truncate per the responsive-layout pattern.

**New layout**
1. **Welcome hero band** — name + greeting, current city pill, profile-strength ring (existing `Ring`) inline on the right, plus a small badge ("Bronze / Silver / Gold / Platinum" from `computeBadge`). Gradient background (primary-light → card).
2. **Quick actions row** — 4 tappable tiles: "Search jobs", "Upload resume" (only if missing), "Complete profile" (only if <80%), "Saved jobs". Lucide icons.
3. **Stats row** — keep 5 stats, restyle as compact cards with delta hint ("This week: +2") where possible (applications & saved within last 7 days from existing query).
4. **Two-column body**
   - Left (lg:col-span-2): **Recommended for you** as JobCards (already wired). Add a small "Why this match?" pill showing top 1-2 matched skills.
   - Right: **Profile checklist** (existing `missing` items) styled as a real to-do with checkbox icons and "X of Y complete" header; **Recent activity** timeline with colored dots; new **Learning corner** card pulling 2 latest `learning_resources` rows (already in DB) with cover image + title.
5. **Empty states** — instead of plain text, illustrated empty states (Lucide icon + heading + CTA) for no recommendations / no activity.
6. **Mobile**: stats become a 2x2 grid; sidebar columns stack under main; hero ring sits beside greeting text.

**Functionality gaps to close (small)**
- Wire `learning_resources` query into the dashboard (table already exists, public read policy in place). Fallback empty state if none.
- Resume re-upload shortcut from dashboard quick action → opens `/candidate/profile` with `?focus=resume` query; profile page already has a resume section, just scroll/highlight on mount.
- Compute "Profile views" from `candidate_profiles.profile_views` (already used).
- Make the strength ring + checklist click-through to the right profile section by appending `?section=...` hash anchors.

## Part 3 — Shared shell polish (`src/components/candidate/CandidateShell.tsx`)

- Header: avatar + name + role pill on the right; notification bell already present, keep it; on mobile the title becomes a small back row.
- Bottom mobile nav already exists in shell — re-verify the 4 most-used items (Dashboard, Jobs, Saved, Profile) with active state highlighting.
- Smooth page transition wrapper using framer-motion `AnimatePresence` (mode="wait") around `children`.

## Verification

Run Playwright via shell to capture screenshots at 375px and 1280px for: `/onboarding/candidate` (each of the 6 steps via seeded admin login), `/candidate/dashboard`. Eyeball: no overflow, ring renders, mobile bottom nav not overlapping content, sticky onboarding footer not clipping inputs. Hit `parseResume` once with the sample PDFs via `invoke-server-function` to confirm the existing path still returns valid JSON.

## Files touched

- `src/routes/_authenticated/onboarding/candidate.tsx` — shell + per-step JSX (logic untouched)
- `src/components/wizard/Questionnaire.tsx` — new two-column layout, vertical stepper, sticky footer
- `src/routes/_authenticated/candidate/dashboard.tsx` — new hero, quick actions, learning card, empty states
- `src/components/candidate/CandidateShell.tsx` — header/footer polish, page transitions
- `src/components/candidate/primitives.tsx` — minor: add a `<TileSelect>` helper used by Work status + Education
- `src/routes/_authenticated/candidate/profile.tsx` — only the small `?focus=resume` / `?section=...` scroll-on-mount handler

No new DB migrations. No new packages.

## Out of scope

- New candidate features (messaging, video resume, referrals) — existing surfaces only.
- Employer / admin redesigns.
- Color/token changes — locked to current JobsKart blue tokens.
