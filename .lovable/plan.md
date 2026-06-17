# JobsKart — Phased Build Plan

A full Apna.co-style blue/grey-collar hiring portal. The spec spans 8 phases. I'll build them sequentially, shipping a working slice each phase so you can review before the next one starts.

## Phase 1 — Design System + Landing Page (this PR)

**Design tokens** (wired into `src/styles.css` as semantic CSS variables, used via Tailwind):
- Primary `#1A55BD`, Primary Dark `#1340A0`, Primary Light `#EEF3FF`
- Light BG `#F5F7FA`, Border `#E5E7EB`, Dark Text `#1A1A2E`, Muted `#6B7280`
- Success `#16A34A`, Amber `#D97706`, Red `#DC2626`
- Card radius 12px, button radius 8px, pill 24px
- Card shadow `0 2px 12px rgba(26,85,189,0.08)`
- Font: Inter (loaded via `<link>` in `__root.tsx`)

**Logo**: uploaded JobsKart logo registered as a Lovable asset (`src/assets/jobskart-logo.png.asset.json`) and used in navbar/footer.

**Landing page sections** (all on `/`, semantic HTML, SEO meta in route `head()`):
1. Sticky white **Navbar** — logo, center links (Jobs / For Employers / Candidates / Resources), Employer Login (outlined) + Candidate Login (solid), mobile hamburger drawer.
2. **Hero** — gradient bg (white → `#EEF3FF`) with soft purple→green blob on right, eyebrow tag, H1 "Your job search ends here", subtext, 3-field pill search bar (title / experience / location + Search button), popular tag chips, hero image placeholder of professional with phone.
3. **Trust** — "Proud to Support" gov logos + "Trusted by 1000+ Enterprises…" company logo strip (placeholders).
4. **Popular Searches** — light-gray bg, left heading + right 3×2 trending category cards.
5. **Browse by Category** — horizontal scroll of icon+label chips (Security, Driver, Delivery, Sales, Telecaller, Warehouse, Housekeeping, Cook, Retail, Field Agent, Nurse, Teacher).
6. **How It Works** — two columns (Candidates / Employers), 3 numbered steps each, blue→green gradient bg.
7. **Stats Banner** — dark blue bg, 4 stats (10L+ Jobs, 50L+ Candidates, 1000+ Employers, 500+ Cities).
8. **Testimonials** — 3 cards, avatar/name/role/stars/quote.
9. **App Download** — gradient bg, Play/App Store badge placeholders, phone mockup placeholder.
10. **Footer** — dark `#1A1A2E`, logo+tagline, 4 link columns, bottom legal row.

Fully responsive (320 / 375 / 768 / 1024 / 1440), hover lift on cards, Indian-context copy (no Lorem ipsum), currency in ₹, numbers in lakh/crore format.

## Phases 2–8 (subsequent PRs, in order)

Each will be its own approval cycle so we can adjust before building.

- **Phase 2** — Auth: `/login` (tabbed), `/signup/candidate` (3-step wizard with profile-strength meter), `/signup/employer` (single-page with company details), `/forgot-password` (OTP). Mobile OTP + email/password + Google. Inline validation, toasts.
- **Phase 3** — Candidate area: sidebar dashboard, `/jobs` search with filters, `/jobs/:id` detail with tabs, `/candidate/applications` (status tabs), `/candidate/profile` (editable sections, strength meter).
- **Phase 4** — Employer dashboard + **smart 4-step Post-a-Job** flow: live title suggestions, AI skill suggestions, market-salary insight, AI description templates, **Job Quality Score** donut with checklist, Classic / Classic+ / Trending selection, My Jobs table with Boost modal.
- **Phase 5** — Candidate DB Access (job-gated search, locked PII until Unlock, 25/job quota) + Job Responses (Applied tab + AI Recommended tab with rotating insight messages and never-empty "similar profiles" fallback) + candidate detail modal.
- **Phase 6** — Company Profile + Verification (GST / CIN / Aadhaar tabs), Team Management (Super Admin / HR Admin / Recruiter), Activity Tracker, Role Permissions Matrix.
- **Phase 7** — Plans (Basic / Pro / Unlimited cards, monthly/quarterly/annual toggle), add-on credits, billing history, Analytics dashboard (4 charts + team performance + AI recs insight).
- **Phase 8** — Notifications (bell dropdown + `/notifications` page), email-pref toggles, mobile polish (bottom tab nav, swipe actions), micro-interactions (animated score, skeleton loaders, toasts), Settings page, role-based 403, SEO pass.

## Technical Notes

- Stack: TanStack Start (existing) — file-based routes under `src/routes/`, route-level `head()` for SEO, semantic tokens only (no hardcoded colors in components).
- Backend (Lovable Cloud) is **not** enabled in Phase 1 — the landing page is pure presentation. I'll propose enabling it at the start of Phase 2 (auth) since we'll need users, profiles, roles, jobs, applications, unlocks, plans, credits, activity logs, and notifications.
- Logo asset uploaded via `lovable-assets` from `/mnt/user-uploads/images_1.png` so it lives on CDN, not in the repo.

## Open Questions Before Phase 2

1. Use **Lovable Cloud** for the full backend (recommended — auth, DB, storage, edge functions in one place)?
2. For Indian mobile OTP, use a real SMS provider (MSG91 / Twilio — needs API key + credits) or stub it during dev?
3. GST / CIN / Aadhaar verification — connect a real KYC API (Karza, Surepass, etc.) or build the UI now and stub responses until you've picked a provider?

**Approving this plan ships Phase 1 only.** I'll come back with a Phase 2 plan right after.