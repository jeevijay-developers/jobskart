## Goal

Kill the boring stacked forms. Replace candidate signup, employer signup, and the 6-step onboarding with a conversational, one-question-at-a-time wizard that opens with mobile number. Rebuild the homepage as a high-conviction marketing surface in a Trust Navy + Emerald palette with a real hero, working search, and live stats.

---

## 1. Conversational Auth Wizard (mobile-first)

New shared component: `src/components/wizard/Questionnaire.tsx`
- Full-bleed split layout. Left = animated brand panel (navy gradient, emerald accent, rotating social-proof line). Right = a single question card at a time with large input, progress dots, Back / Continue, Enter-to-advance.
- Framer-motion slide+fade between steps. Auto-focus next field. Inline validation. Keyboard first.

### `/signup/candidate` — rewritten
Step order:
1. Mobile number (+91 prefix, 10-digit validate)
2. OTP — 6-digit input. **Stub**: any 6 digits accepted; show "Demo mode" hint. Persist `mobile_verified=true` on profile.
3. Full name
4. Email
5. Password (with strength meter)
6. "What brings you here?" chip select → routes to `/onboarding/candidate` (fresher / experienced / switching)

On submit: `supabase.auth.signUp` with email+password, `raw_user_meta_data` includes `mobile`, `full_name`, `user_type='candidate'`, intent. Existing `handle_new_user` trigger already seeds profile + candidate_profiles.

### `/signup/employer` — same shell, employer copy
Steps: Mobile → OTP → Your name → Work email → Password → Company name → Company size chip. Post-signup creates company + employer_members row, redirects to `/employer/dashboard`.

### `/onboarding/candidate` — convert existing 6-step wizard to same Questionnaire shell
Same 6 buckets currently saved (basics, experience, skills, education, preferences, resume), but rendered one prompt per screen with the same animated layout. Each answer auto-saves via existing `saveStep`. Final screen = celebratory "Profile X% complete" with CTA to dashboard.

### Schema touch (single migration)
- Add `profiles.mobile_verified boolean default false`
- Add `profiles.signup_intent text` (nullable)
No RLS changes (existing policies cover it).

---

## 2. Homepage rebuild (`src/routes/index.tsx`)

Trust Navy + Emerald palette tokens added to `src/styles.css`:
- `--background` paper `#f5f0e0`-tinted off-white
- `--primary` emerald `#10b981`
- `--brand-navy` `#0f1b3d`, `--brand-navy-2` `#1e3a5f`
- `--gradient-hero` navy → navy-2 radial with emerald glow
- `--shadow-elegant` emerald-tinted

Sections (in order):
1. **Sticky transparent navbar** that solidifies to navy on scroll. CTAs: "Find Jobs", "For Employers", "Login".
2. **Hero** — navy gradient bg, large display headline ("Find the job. Skip the noise."), subhead, prominent search card (keyword + city + Search button) that deep-links to `/jobs?q=&city=`. Right side: floating job-card mockups with subtle motion.
3. **Live stats counter strip** — animated count-up for: active jobs, verified companies, candidates hired, cities. Pulled live from `jobs`, `companies`, `profiles` via a single `createServerFn` (`getPlatformStats`) using the server publishable client with narrow anon SELECTs.
4. **Trending searches / popular roles** — emerald chips deep-linking into `/jobs` with preset filters.
5. **Final CTA band** — split: candidate CTA (emerald) + employer CTA (navy outline) → `/signup/candidate` / `/signup/employer`.

SEO: route `head()` with title, description, og:title, og:description, og:image (existing logo asset).

---

## 3. Technical details

- Stub OTP lives entirely client-side for now; mobile is stored on profile but no real SMS sent. Clear "Demo mode" badge so it's obviously a stub. Easy swap-in later for Supabase phone auth or Twilio/MSG91.
- Questionnaire state held locally with `useReducer`; navigation guarded so refresh doesn't lose progress (sessionStorage backup keyed by flow id).
- Animations: `framer-motion` (already in deps if present; otherwise `bun add framer-motion`).
- All colors via tokens — no hardcoded hex in components.
- Public stats query: new `src/lib/stats.functions.ts` server fn returning `{ jobs, companies, candidates, cities }`. Loader uses `ensureQueryData`; component uses `useSuspenseQuery`.

---

## 4. Files

Create:
- `src/components/wizard/Questionnaire.tsx`
- `src/components/wizard/steps/*` (MobileStep, OtpStep, TextStep, PasswordStep, ChipStep)
- `src/lib/stats.functions.ts`
- `src/components/home/Hero.tsx`, `StatsStrip.tsx`, `TrendingRoles.tsx`, `DualCTA.tsx`

Edit:
- `src/routes/signup.candidate.tsx` — replace body with Questionnaire
- `src/routes/signup.employer.tsx` — replace body with Questionnaire
- `src/routes/_authenticated/onboarding/candidate.tsx` — wrap existing steps in Questionnaire
- `src/routes/index.tsx` — new hero + sections
- `src/styles.css` — Trust Navy + Emerald tokens
- `src/components/site/Navbar.tsx` — transparent→solid on scroll

Migration:
- `profiles.mobile_verified`, `profiles.signup_intent`

---

## Out of scope (ask separately if wanted)
- Real SMS OTP (needs SMS provider secret)
- Featured companies carousel / How-it-works / Testimonials sections (you only picked Hero + search + stats)
- Employer onboarding wizard beyond signup
