
## Goal

Turn the homepage into a sales-grade marketing surface in the style of the attached reference (clean white canvas, bold headline left, a floating "device + proof cards" cluster right, colored geometric accents). Then sweep the rest of the product so every promised feature actually works and looks polished on mobile.

## Part 1 — Landing page rebuild (`src/routes/index.tsx`)

Keep the JobsKart blue token system — no new hardcoded colors. Replace the current hero + sections with a sales-focused narrative:

1. **Hero (white canvas, reference-style)**
   - Left: eyebrow chip "India's #1 verified hiring platform", H1 "Get your next job. **Skip the noise.**" (blue accent on one word, like the reference's "Google"), 1-line sub, search bar (job + city), trust row (Verified employers · Free to apply · 4.6★).
   - Right: a **device mockup cluster** — one AI-generated phone screenshot of the candidate app + 3-4 floating Lucide-iconed proof cards (BadgeCheck "Verified employer", IndianRupee "₹28k salary unlocked", Users "1,240 hired this week", MapPin "Jobs in 500+ cities"). Colored geometric blobs (blue/yellow/red/green circles) behind, matching reference vibe.
   - AI images generated with `imagegen` (fast tier, transparent PNG for the phone frame, JPG for the dashboard screenshot inside it). Saved to `src/assets/` and imported.

2. **Logos / social proof strip** — "Trusted by 1,000+ employers" + 6 muted brand wordmarks (placeholder text logos, no fake company marks).

3. **How it works** — 3-step row with Lucide icons (Smartphone → UserCheck → Briefcase): Enter mobile · Build profile in 60s · Apply in one tap. Mirror version for employers below (Building2 → FileText → Users).

4. **Feature showcase (2 alternating rows w/ AI mockups)**
   - Row A (candidate): AI image of resume-parse screen + copy "Upload resume, AI fills your profile." Lucide bullets (FileScan, Sparkles→Wand2, Target).
   - Row B (employer): AI image of database/credits screen + copy "Search 5L+ candidates. Unlock with credits." Bullets (Database, Coins, ShieldCheck).

5. **Stats strip** — keep existing live `getPlatformStats` counters, restyle as a single inline band.

6. **Pricing teaser (employer credits)** — 3 cards (Starter / Growth / Enterprise) pulling from existing seeded packs, "Most popular" badge on middle.

7. **Testimonials** — 3 cards with avatar initials, name, role, quote. Lucide `Quote` icon. Static seeded content.

8. **FAQ** — 6 Q&As in shadcn `Accordion` (mobile-friendly, SEO-friendly).

9. **Dual CTA band + Footer** — keep existing dual CTA, tighten copy.

All sections fully responsive (single-column < md, 2-col md+, hero stacks on mobile with mockup below copy). No Sparkles/Star decoration spam — only purposeful Lucide icons.

## Part 2 — AI image generation

Generate 3 assets up-front with `imagegen` (premium tier for the phone screenshot since it contains UI text):
- `src/assets/landing-phone-candidate.png` (transparent, phone-shaped mockup of candidate dashboard with job cards, blue accents)
- `src/assets/landing-resume-parse.jpg` (browser window mockup of resume upload + auto-filled fields)
- `src/assets/landing-employer-db.jpg` (browser window mockup of candidate database with unlock buttons)

Each generated once, imported as ES6, no re-prompt loops.

## Part 3 — Feature/QA sweep (functional polish, no scope creep)

Quick pass over the existing flows to make sure nothing user-visible is broken or half-finished:

1. **Auth** — verify `/auth` mobile+OTP path lands candidate on `/onboarding/candidate` if no profile, `/candidate/dashboard` if profile exists. Same for employer. Verify seeded admin (`9098326235` / `11223344@`) still routes to `/admin`.
2. **Onboarding (candidate)** — confirm work-status branching (fresher/experienced/student), no step reset, multi-select work mode persists, headline 200 chars, resume upload on Basics step only.
3. **Resume parsing** — confirm `parseResume` succeeds on the two sample PDFs (already mounted at `/mnt/user-uploads/`) via `invoke-server-function`. If a field crashes, tighten the Zod schema (`.catch(undefined)` per row).
4. **Employer** — `/employer/jobs/new` posts a job, `/employer/database` unlock decrements credits, `/employer/credits` shows ledger.
5. **Admin** — spot-check Users/Jobs/Masters/Resumes pages load with no console errors.
6. **Mobile responsiveness** — re-check landing, auth, onboarding, candidate dashboard, employer dashboard at 375px and 768px. Fix overflow / cramped touch targets only where found.

Verification uses Playwright via shell for landing + auth + onboarding (screenshots at 375 and 1280), and `invoke-server-function` for `parseResume`.

## Files touched

- `src/routes/index.tsx` — full rebuild
- `src/assets/landing-phone-candidate.png`, `landing-resume-parse.jpg`, `landing-employer-db.jpg` — new (AI generated)
- `src/components/site/Navbar.tsx`, `Footer.tsx` — only if QA finds breakage
- Targeted fixes in onboarding / employer / admin files only if QA surfaces real bugs

No DB migrations. No new dependencies (framer-motion + lucide-react + shadcn already in).

## Out of scope

- New backend features (payments, learning content, new admin modules) — existing ones are kept as-is, only verified.
- Brand-new color palette — locks to existing JobsKart blue tokens.
