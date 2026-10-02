# Resume Builder: LaTeX-style layout controls

> **Status: Phases 1–3 implemented** (2026-10-02). Deferred items below remain deferred.
>
> Findings during implementation worth keeping:
> - **Root cause of the loose "lining":** react-pdf resolves a unitless `lineHeight` against the element's *own* `fontSize` (default 18pt), not the inherited page size, so `lineHeight: 1.45` gave a ~26pt line pitch for 10.5pt text. Every style that sets `lineHeight` must also set `fontSize` (see `templates/buildStyles.ts`).
> - Profile dates ("2020-01-15") are now shown as "Jan 2020"; an open-ended job with an empty end date shows "Present" (previously rendered "2020-01 – ").
> - Section titles now travel with their first item (`wrap={false}` group) instead of relying on `minPresenceAhead`, which could still strand a title when the first item jumped to the next page.
> - Layout is validated/clamped server-side (`normalizeLayout`) before a version is saved.

## Context

The generated/previewed resumes have real layout bugs (bullets don't hang-indent when wrapped, dates aren't right-aligned against titles, the Modern template loses its top margin on page 2+, spacing values are duplicated and drifting between the two templates). On top of fixing those, the user wants the structural precision LaTeX resume editors (moderncv, AltaCV, Awesome-CV) give — margins, spacing, fonts, section styling — exposed as UI controls, **not** free-form drag-anywhere positioning (already discussed and rejected: breaks ATS reading order, breaks page reflow, unusable on mobile).

Research confirms the LaTeX feature set maps cleanly to structured settings:
- `geometry` package → margin presets + custom per-side margins
- `enumitem`/`vspace` → section/line spacing scale
- moderncv's entry macros → structural title-left/date-right rows (not manual positioning)
- moderncv's style/color themes → section-header style + accent color
- AltaCV's two-column layout → a future third template (deferred, see below)
- AltaCV's `accsupp` icon-safety caution → the reason contact icons are dropped from this round (see decisions below)

Decisions already made with the user (recommended options chosen in each case):
- **Fonts**: built-in react-pdf fonts only (Helvetica/Times/Courier) this round. No new asset files, no licensing to track. Devanagari/Hindi support is explicitly deferred to a later round once a font source is picked.
- **Fit-to-one-page**: deferred. It needs an iterative render→measure→shrink loop react-pdf has no cheap API for; not worth the risk/perf cost this round.
- **Contact icons**: dropped entirely. Real ATS risk, no clean safe implementation in react-pdf, not worth it.
- **Section/item reorder**: up/down arrow buttons, not drag-and-drop. No new dependency, works the same on mobile and desktop.

This keeps the round scoped to: bug fixes + the core layout-settings system (margins, font choice from built-ins, size, spacing, header style, accent color) + section reorder/custom-section alignment.

## Grounding facts (confirmed against the installed code)

- `@react-pdf/renderer`'s `style` prop accepts plain object literals identically to `StyleSheet.create()` output (confirmed in `node_modules/@react-pdf/types/style.d.ts`) — no workaround needed to build styles dynamically per-render from settings.
- `resume_versions.snapshot` already stores the full `ResumeSchema` jsonb per version with no migration needed for new optional fields (same pattern `ResumeExtras` already used).
- `selectedTemplate` today is local `useState`, spliced into the live-preview snapshot instantly (no "Save" gate), and only persisted into a new `resume_versions` row when "Generate & Save" is clicked. `layout` settings follow this exact same pattern.
- Two independent, duplicated bullet-rendering code paths exist today: `templates/sections.tsx` (achievements) and `templates/richText.tsx` (parsed bullets). Both need the hanging-indent fix; consolidate onto one shared renderer rather than fixing both separately.

## Phase 1 — Bug fixes (no schema/UI change, ship first)

Files: `src/lib/resumeBuilder/templates/sections.tsx`, `templates/richText.tsx`, `templates/classicAts.tsx`, `templates/modern.tsx`, new `templates/theme.ts`.

1. **Hanging-indent bullets**: export a shared `BulletLine` component from `richText.tsx` (flexbox row: fixed-width glyph column + `flex:1` text column) and have `sections.tsx`'s achievement-bullet rendering use it instead of its own duplicate `<Text>{"•  "}...</Text>`.
2. **Title-left / date-right row**: in `sections.tsx`, replace the joined-string `itemMeta` text with a `<View style={{flexDirection:"row", justifyContent:"space-between"}}>` — left side (company/institution/location), right side (`dateRange()` output). Applies to experience, education, certification blocks.
3. **Modern template page-2 padding**: give `modern.tsx`'s `page` style a `paddingTop` and compensate the header band's negative margin so page 1 still looks flush while page 2+ gets proper top spacing. Verify visually by rendering a 2-page test resume (this interacts with react-pdf's page-break/negative-margin behavior, confirm empirically, not just by reading source).
4. **Shared `theme.ts`**: new file exporting a `BASE_THEME` object (default sizes/colors/spacing) both templates import instead of hardcoding duplicated values. This is also the seam Phase 2's `buildResumeStyles` builds on.
5. **Orphan control**: add `minPresenceAhead` to the first item inside each section's wrapper `View`, not just the section title, so a title can't be orphaned with nothing below it.

## Phase 2 — Core layout settings (the main "LaTeX-style" ask)

### 2a. New type — `src/lib/resumeBuilder/schema.ts`

```ts
export interface ResumeLayoutSettings {
  marginPreset: "compact" | "standard" | "spacious" | "custom";
  margins?: { top: number; bottom: number; left: number; right: number }; // pt, only when "custom"
  fontFamily: "helvetica" | "times" | "courier"; // built-in react-pdf fonts only this round
  baseFontSize: number; // pt, default 10.5
  lineHeightScale: number; // multiplier, default 1.0
  sectionSpacingScale: number; // multiplier, default 1.0
  sectionHeaderStyle: "underline" | "plain" | "colored";
  accentColor: string; // hex
}
```

Add `layout?: ResumeLayoutSettings` to `ResumeSchema`, next to `templateId`. Optional field — every existing stored version renders identically since templates fall back to each template's own "default layout as it looks today" when `layout` is undefined (resolve per-template defaults, not one shared default, since Classic ATS and Modern currently differ in `sectionHeaderStyle`/spacing).

`buildResumeSnapshot()` in `snapshot.ts` does not need to set `layout` — leave undefined, same as how `templateId` is independently hardcoded there today.

### 2b. Shared style builder — new `src/lib/resumeBuilder/templates/buildStyles.ts`

```ts
export function buildResumeStyles(theme: BaseTheme, layout: ResumeLayoutSettings): TemplateStyles
```

Resolves margins (preset or custom), maps `fontFamily` to the actual react-pdf font-family string, applies `baseFontSize`/`lineHeightScale`/`sectionSpacingScale` as multipliers over the theme's base values. Returns a plain object — confirmed no `StyleSheet.create()` requirement.

`classicAts.tsx` / `modern.tsx` change from a static module-scope `StyleSheet.create({...})` to `const styles = buildResumeStyles(CLASSIC_THEME, resume.layout ?? DEFAULT_CLASSIC_LAYOUT)` computed in the component body (reacts to `resume.layout` on every render, required for the live preview to reflect settings instantly).

### 2c. Settings UI — new `src/components/candidate/ResumeLayoutEditor.tsx`, wired into `src/routes/_authenticated/candidate/resume-builder.tsx`

- Local `useState<ResumeLayoutSettings>`, no "Save changes" gate (matches `selectedTemplate`'s existing live-preview behavior — layout never touches `resume_drafts`). Spliced into the `<PDFViewer>` prop the same way `templateId` already is; persisted into `resume_versions.snapshot.layout` only when "Generate & Save" is clicked.
- Reset to the newly-selected template's defaults on template switch (avoids e.g. a "colored" header style carrying over to a template that doesn't expect it).
- New collapsible "Layout & Design" panel, placed under the template picker cards, collapsed by default.
- Controls: margin preset segmented control (+ custom 4-value steppers), font family dropdown (Helvetica/Times/Courier), base font size stepper, line spacing stepper, section-header style 3-way toggle, accent color swatch picker (5-6 curated options + hex input).

## Phase 3 — Section reorder & custom section alignment

Files: `src/lib/resumeBuilder/schema.ts`, `snapshot.ts`, `src/components/candidate/ResumeExtrasEditor.tsx` (or a small new panel), `resume-builder.tsx`.

- Add `extras.sectionOrder?: string[]` (section ids) to `ResumeExtras`, applied as a final reorder pass at the end of `applyResumeExtras()` — unlisted sections keep natural order, appended at the end. This persists reorder across sessions through the same save-gated extras flow that already exists, no `ResumeSchema` change needed.
- UI: a small list of current section titles with up/down buttons (no new dependency), likely added to the existing "Edit Your Resume" panel area.
- Extend `ResumeExtras.customSections` items with `align?: "left" | "center" | "right"` (default `"left"`), consumed in `sections.tsx`'s custom-text rendering via `textAlign`. Additive, optional, no migration.

## Deferred (explicitly out of scope this round)

- Fit-to-one-page auto-shrink.
- Devanagari/Hindi font support (needs a font-sourcing decision first).
- Contact icons.
- Two-column/sidebar (AltaCV-style) template — biggest net-new visual work, should build on Phase 2's `buildResumeStyles` infra once that's proven stable, not before.
- True drag-and-drop reordering.

## Verification

- Typecheck (`npx tsc --noEmit -p .`) after each phase — this repo has pre-existing unrelated errors (confirmed in prior rounds), so only check for new errors in touched files.
- Render both templates server-side (`renderResumeToPdf`) and client-side (headless Chrome via Playwright, same approach used earlier this session to verify the react-pdf fix) with: a 2-page-length sample resume (checks Modern's page-2 padding fix and orphan control), a resume with long wrapped bullet text (checks hanging indent), and each margin preset / font family / header style combination at least once.
- Confirm an old saved `resume_versions` row (no `layout` key) still renders pixel-identical to before these changes, since `layout` must be fully optional with safe per-template defaults.
- Manual check in the running dev server: open Resume Builder, change each layout control, confirm the live preview updates instantly with no "Save" step, then Generate & Save and confirm the downloaded PDF matches the preview exactly (the core guarantee this whole rendering architecture exists to protect).
