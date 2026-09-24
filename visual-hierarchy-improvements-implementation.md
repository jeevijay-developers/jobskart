# Visual Hierarchy Improvements — Implementation Plan

Goals: stronger section separation · cleaner spacing & grouping · highlight important fields · reduce repetitive visual patterns · improve scanability.

## Current state (audit findings)

**Solid foundation — keep:**
- Design tokens in `src/styles.css`: brand primary (#1A55BD), surface/card/border layers, feedback colors (success/warning/destructive), `--shadow-card` / `--shadow-card-hover` / `--shadow-soft` / `--shadow-elegant`, radius scale off `--radius: 0.75rem`, Inter font.
- App card language: `rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]` (used by `SectionCard`, dashboards, StatCell, JobCard).
- `StatCard` label pattern (`text-[11px] font-semibold uppercase tracking-wider text-muted-foreground`) — good hierarchy anchor.

**Problems found:**
1. **Two competing card languages**: shadcn `Card` (`rounded-xl` + default `shadow`, p-6) vs app pattern (`rounded-2xl` + `--shadow-card`, p-4/p-5/p-6 inconsistent).
2. **Inconsistent page headers**: `CandidateShell` h1 = `text-2xl sm:text-3xl`, `EmployerShell` h1 = `text-xl sm:text-2xl lg:text-3xl`; container padding `px-4` vs `px-3`.
3. **Five different section-heading styles**: `text-base font-semibold sm:text-lg` (SectionCard), `text-base font-bold sm:text-lg` (candidate dashboard), `text-sm font-bold` (employer sidebar), `text-lg font-bold` (empty states), plus icon-gap and "View all →" link placement vary per page.
4. **Hand-rolled sections duplicate SectionCard**: employer dashboard writes `rounded-2xl border bg-card p-4 sm:p-5` inline in 4+ places; padding scale differs from `SectionCard` (p-5 sm:p-6).
5. **Badge/pill sprawl**: shadcn `Badge` has only 4 variants (no success/warning/info), so ~15 hand-rolled pill styles exist (`bg-success/10 text-success`, `bg-white/20 ring-white/30`, `border-primary/20 bg-primary-light`, `bg-warning-light`…). Status tones are centralized only for applicants (`src/lib/applicantStatus.ts`).
6. **Arbitrary type sizes**: `text-[10px]`, `text-[11px]`, `text-[26px]` scattered; no named scale.
7. **Weak field emphasis in forms**: `Field` labels all look identical (`text-sm font-medium`); required = red asterisk only; no visual distinction between critical and optional inputs.
8. **Duplicated component roles**: `StatCell` (candidate) vs `StatCard` (employer) — same job, different markup/sizing; two `EmptyState` implementations.

## Design decisions (the target system)

**Type scale (name it, use it everywhere):**
| Role | Classes |
|---|---|
| Page title (h1) | `text-2xl font-bold tracking-tight sm:text-3xl` — unify both shells to this |
| Section title (h2) | `text-base font-bold sm:text-lg` |
| Card/subsection title (h3) | `text-sm font-bold` |
| Eyebrow/label | `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs` |
| Body | `text-sm text-foreground` / secondary `text-sm text-muted-foreground` |
| Meta/caption | `text-xs text-muted-foreground` |
| Big number | `text-2xl font-bold tabular-nums sm:text-3xl` |

**Spacing rhythm (grouping rule):**
- Between page sections: `space-y-6` (already common) — enforce everywhere.
- Card padding: standardize on `p-5 sm:p-6` (SectionCard value); compact variant `p-4 sm:p-5` only for sidebar/stat cards — add as `SectionCard size="compact"` instead of hand-rolling.
- Inside cards, group related rows with `divide-y divide-border` (already used in employer applicants list) rather than nested borders — fewer boxes inside boxes.
- Label→input gap `mb-1.5`, field→field gap `gap-4`, related-field clusters `gap-3`.

**Separation strategy (border + shadow + background, pick by level):**
- Level 1 (page sections): card on `bg-surface` page — border + `--shadow-card`. Current, keep.
- Level 2 (groups inside a card): NO nested card; use `divide-y` rows or `bg-surface rounded-xl` inset panels (pattern exists in onboarding experience entries).
- Reserve gradient/hero treatment for exactly one element per page (hero bands already do this).

**Emphasis for important fields:**
- Required-field marker: keep asterisk, but de-emphasize optional instead — optional labels stay plain, add muted "(optional)" suffix (already done inconsistently; standardize in `Field`).
- Key/primary fields in long forms get `Field emphasis` variant: `bg-primary-light/50 border-primary/20` inset panel or a 2px left accent bar — used sparingly (max 1–2 per screen) for the field that drives conversion (e.g. job title in JobWizard, resume in ApplyDialog).
- Important values in read-only views (salary, notice period, credits): `font-bold tabular-nums text-foreground` vs muted labels.

## Phases

### Phase 1 — Foundation: tokens, Badge tones, SectionCard variants
Files: `src/components/ui/badge.tsx`, `src/components/candidate/primitives.tsx`, `src/styles.css`.
- Extend `badgeVariants` with `success`, `warning`, `info` (primary-light), `muted` (surface) tones using existing CSS vars — mirrors `applicantStatus.ts` tones so that map can consume Badge.
- Add to `SectionCard`: `size?: "default" | "compact"`, optional `icon`, optional `subtitle`, and a `footer` slot; heading becomes the canonical h2 style. Add `SectionHeading` standalone export for sections that aren't cards (dashboards use bare `<section>` + heading + "View all" link).
- Add `Field` prop `emphasis?: boolean` (accent styling) and standardize optional suffix.
- Do NOT touch shadcn `Card` (used by admin/ui surfaces); instead stop introducing it in candidate/employer pages.
- Acceptance: Badge renders all tones in light + dark mode; SectionCard compact matches current employer-dashboard hand-rolled sections pixel-closely.

### Phase 2 — Unify shells & page headers
Files: `src/components/candidate/CandidateShell.tsx`, `src/components/employer/EmployerShell.tsx`.
- Same h1 scale (`text-2xl font-bold tracking-tight sm:text-3xl`), same subtitle style, same container padding (`px-4 sm:px-6 lg:px-8`), same header `mb-6`.
- Keep EmployerShell extras (CreditChip, bell, headerLeft) — only align typography/spacing.
- Acceptance: candidate and employer pages side-by-side look like one product; mobile tab bars untouched.

### Phase 3 — Section separation on dashboards (biggest visible win)
Files: `src/routes/_authenticated/employer/dashboard.tsx`, `src/routes/_authenticated/candidate/dashboard.tsx`.
- Replace all hand-rolled `rounded-2xl border bg-card p-4 sm:p-5` sections with `SectionCard` (compact for sidebar) + `SectionHeading` with the "View all →" action slot.
- Enforce `space-y-6` page rhythm; inside activity/applicant lists use `divide-y divide-border` rows.
- Unify stats: pick ONE stat component — extend employer `StatCard` with an optional `icon` + `to` link (candidate `StatCell` behavior), move it to `src/components/shared/StatCard.tsx`, use on both dashboards; delete `StatCell`.
- Unify empty states: extract candidate dashboard `EmptyState` to `src/components/shared/EmptyState.tsx`; replace employer's hand-rolled `border-2 border-dashed` block.
- Acceptance: both dashboards use only shared components for sections/stats/empty states; no inline card classes remain in these two files.

### Phase 4 — Highlight important fields in key forms
Files: `src/components/employer/JobWizard.tsx`, `src/components/candidate/ApplyDialog.tsx`, `src/routes/_authenticated/onboarding/candidate.tsx`.
- JobWizard: `emphasis` on Job title + Salary range (the two fields that determine listing quality); step headers get eyebrow style; group location/interview/pay clusters with inset `bg-surface rounded-xl` panels instead of flat grids.
- ApplyDialog: emphasis on Resume slot.
- Onboarding: emphasize `expStatus` choice cards (already button-cards — align selected state to `border-primary bg-primary-light`); experience/education entries switch to inset panel grouping (already `bg-surface` — standardize radius/padding to `rounded-xl p-4`).
- Coordinate with `dynamic-conditional-forms-implementation.md` — do these edits in the same passes to avoid double-touching files.
- Acceptance: each screen has ≤2 emphasized fields; emphasis is visible in dark mode.

### Phase 5 — Kill repetitive pill/badge patterns
Files: sweep candidate + employer routes (`applications.tsx`, `jobs.tsx`, `company.tsx`, `database.tsx`, `JobCard.tsx`, dashboard heroes).
- Replace hand-rolled status pills with the new Badge tones; keep hero-band white/translucent pills (they sit on gradient — legitimately different).
- Centralize any remaining status→tone maps next to `applicantStatus.ts`.
- Acceptance: `grep -c "rounded-full bg-"` across routes drops measurably; every status badge uses a Badge variant.

### Phase 6 — Scanability pass (lists & cards)
Files: `src/components/site/JobCard.tsx`, `src/routes/_authenticated/candidate/applications.tsx`, `src/routes/_authenticated/employer/jobs.tsx`.
- JobCard: enforce title (`text-base font-bold`) → company/meta (`text-sm text-muted-foreground`) → badge row order; salary always `font-semibold tabular-nums`; max 3 meta items on mobile (truncate rest).
- List rows everywhere: consistent `divide-y`, `hover:bg-surface`, chevron affordance on the right (pattern exists in employer top-jobs list).
- Numbers always `tabular-nums`.
- Acceptance: at 375px a job card scans in one pass — title, salary, location, one badge row.

## Out of scope
- Shadcn Card refactor / admin pages restyle (functional, low traffic).
- Font change or new typeface pairing.
- Dark-mode redesign (only verify each phase in dark mode).
- Marketing/public site (`src/routes/index.tsx`, AuthShell) beyond shared Badge adoption.

## Risks & mitigations
- **Visual regressions across many pages**: phases are ordered so shared components land first (Phase 1–2), then per-screen adoption (3–6); commit per screen-group, verify light+dark at 375px and 1280px before each commit.
- **Overlap with conditional-forms plan**: Phase 4 touches the same files as that plan's Phases 2–4 — sequence this plan's Phase 4 immediately after (or merge into) the forms work.
- **Lovable sync**: keep main working at every commit; never rewrite pushed history (AGENTS.md).

## Sizing
| Phase | Effort | Impact |
|---|---|---|
| 1 Foundation (Badge/SectionCard/Field) | M | Enables all else |
| 2 Shell unification | S | High (cross-product consistency) |
| 3 Dashboards | M | Highest (first thing users see) |
| 4 Form emphasis | M | High (conversion) |
| 5 Badge sweep | M | Medium |
| 6 Scanability pass | S | Medium-High |
