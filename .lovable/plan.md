## Goal

The current UI feels generic "vibe-coded": Sparkles/Star icons everywhere read as AI clip-art, and the homepage uses an emerald/navy palette that does not match the real JobsKart brand color (`--primary: #1A55BD`, blue). Tighten the visual language to look like a real hiring product (Naukri / Apna tier), using only Lucide icons and the brand blue.

## Scope

1. Remove every `Sparkles` and `Star` icon usage across the app
2. Replace each with a meaningful, professional Lucide icon that matches the context
3. Re-skin the homepage hero, stats, value props, and dual CTA to use JobsKart blue tokens, not emerald
4. Re-skin the conversational signup wizard (`Questionnaire.tsx`) to the same brand blue
5. Strengthen the UI: real shadows, sharper type hierarchy, denser metadata, no playful "✨/⭐" emoji-in-copy

Out of scope: backend, data, routing, server functions, the candidate dashboard logic (only the inline Sparkles next to "Finish your profile" / "profile views" gets swapped for a context-appropriate Lucide icon).

## Icon swap map (all → `lucide-react`)

| Location | Current | Replace with | Reason |
|---|---|---|---|
| `index.tsx` hero eyebrow | `Sparkles` | `BadgeCheck` | "India's #1 verified platform" reads as trust, not magic |
| `index.tsx` trust strip | `Star` "4.6★ on Play Store" | `Award` + plain text "4.6 rating · Play Store" | drop the ★ glyph too |
| `index.tsx` ValueProps "AI-matched" | `Sparkles` | `Target` | matching = targeting, not sparkle |
| `onboarding/candidate.tsx` step pill | `Sparkles` | `Compass` | wayfinding feels right for a wizard |
| `candidate/profile.tsx` profile-views chip | `Sparkles` | `Eye` | literally "views" |
| `candidate/dashboard.tsx` "Finish your profile" | `Sparkles` | `ListChecks` | it's a checklist |
| `Questionnaire.tsx` trust bullet "AI-recommended" | `Sparkles` | `Target` | same as above; reword to "Smart matches by role + city" |
| `Questionnaire.tsx` brand panel `Zap` accent | `Zap` | `Briefcase` | reads as a jobs product, not a power-up |
| `u.$slug.tsx` "Looking for" section | `Sparkles` | `Compass` | preferences/direction |

Also: remove the literal ★ character from the "4.6★" copy and any "✨/⭐" emoji in marketing strings.

## Brand realignment (homepage + wizard)

The project's real token is `--primary: oklch(0.515 0.176 261)` = **#1A55BD** (JobsKart blue). The current home page hardcodes `#10b981` emerald and `#0f1b3d` navy — both off-brand. Fix by switching everything to design tokens / brand blue:

- Hero background gradient: deep brand blue → primary-dark, with a subtle blue radial glow instead of green
- Eyebrow pill, accent text ("Skip the noise."), trust icons, popular-search hover, CountUp accent, value-prop icon tiles, trending-role hover, CTA card, search submit button → all use brand blue (`bg-primary`, `text-primary`, `text-primary-foreground`, `ring-primary/30`, `bg-primary/10`)
- Dual CTA: candidate card = brand blue gradient (`#1A55BD → #1340A0`), employer card = near-black `#0B1220` with brand-blue accent (instead of navy/emerald split)
- Replace inline `style={{ background: "linear-gradient(…emerald…)" }}` with token-based Tailwind classes (`bg-primary`, `bg-gradient-to-br from-primary to-primary-dark`). No raw hex literals in JSX.
- Add one new token if missing: `--shadow-elegant: 0 20px 60px -20px color-mix(in oklab, var(--primary) 35%, transparent)` in `src/styles.css` and use it for the search card + stats strip
- Apply the same swap to `Questionnaire.tsx` brand panel (currently navy + emerald) → brand blue + primary-dark gradient

## Strengthen the UI (no new sections)

- Tighten the search card: 1px hairline border `border-border`, taller inputs (h-14), bolder label text, kbd hint "⌘K" on the right (using `Command` Lucide icon)
- Floating job cards: replace the rotated playful tilt with a clean stacked-card layout (slight offset, no rotation), add a small `MapPin` + `IndianRupee` row, a `BadgeCheck` chip for "Verified"
- Stats strip: monospace tabular numbers (`font-variant-numeric: tabular-nums`), thinner divider, slimmer icon tiles
- Trending roles: render as compact pill-rows with `TrendingUp` icon prefix instead of large bordered cards-with-arrows
- Value props: add a thin top accent bar in primary, remove the rounded-soft card vibe, use `border` + flat surface for a more editorial feel
- Dual CTA: real product mock thumbnail block on the right of each card (CSS only — small fake "applied / shortlisted / interview" pipeline) so the section stops feeling like two empty colored slabs

## Technical notes

- Files edited: `src/routes/index.tsx`, `src/components/wizard/Questionnaire.tsx`, `src/routes/_authenticated/onboarding/candidate.tsx`, `src/routes/_authenticated/candidate/profile.tsx`, `src/routes/_authenticated/candidate/dashboard.tsx`, `src/routes/u.$slug.tsx`, `src/styles.css` (add `--shadow-elegant` if absent)
- No new dependencies, no new routes, no schema changes
- All colors via tokens — no hex literals in components after this pass
- Lucide icons used (all already in the package): `BadgeCheck`, `Award`, `Target`, `Compass`, `Eye`, `ListChecks`, `Briefcase`, `Command`, `MapPin`, `IndianRupee`, `TrendingUp`, `ShieldCheck`, `CheckCircle2`, `Search`, `ArrowRight`, `Building2`, `Users`, `Globe2`

## Acceptance

- `rg "Sparkles|\\bStar\\b" src/` returns zero matches
- `rg "#10b981|#059669|emerald-" src/routes/index.tsx src/components/wizard/Questionnaire.tsx` returns zero matches
- Homepage hero, CTAs, and signup wizard all read as JobsKart blue
- No ★/✨/⭐ glyphs remain in any marketing copy
