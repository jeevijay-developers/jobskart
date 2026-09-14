# Autocomplete suggestions for job search + city fields

## Problem

The "Job title, skill or company" and "City" search inputs on `/jobs` (and the
homepage hero search, which duplicates the same two fields with different
styling) are plain text inputs with no suggestions. We want typeahead
suggestions where the typed text matches the start of any *word* in the
suggestion (not just an overall substring), with the matched prefix
highlighted, selectable by mouse or keyboard.

## Data sources

- **Job titles** — `public.job_titles_master` (`title`, `is_active`,
  `is_custom`). Already exists, seeded with ~20 titles, grows slowly via
  admin/user additions (`addCustomJobTitle`), and is publicly readable
  (`GRANT SELECT ... TO anon, authenticated`). Fetched once client-side and
  cached in memory (module-level cache) since the dataset is small — no need
  for a live per-keystroke query or a new server function. Not reusing
  `JobTitleAutocomplete.tsx`/`searchJobTitles` directly: that path requires
  auth (breaks anonymous browsing on public search), does plain substring
  matching, and has no highlighting.
- **Cities** — `INDIAN_CITIES` from `src/lib/options.ts`. This is the list
  already used everywhere else in the app (onboarding, job posting, profile).
  The `cities` DB table exists but is empty and unused outside the admin
  masters screen, so it's not the right source here.

## Matching

Pure function in `src/lib/autocomplete.ts`:

```
matchSuggestions(query: string, pool: string[], maxResults = 8): MatchResult[]
```

- Splits each candidate string into words (alnum runs).
- Keeps candidates where *any* word starts with the lowercased query.
- Ranks whole-string-prefix matches above mid-string word matches, then
  alphabetically; caps at `maxResults`.
- Returns highlight segments (`{ text, matched }[]`) per result so the UI can
  bold/color exactly the matched prefix within each matching word.

## Component

`src/components/site/AutocompleteInput.tsx` — self-contained
`position: relative` wrapper owning the `<input>` and its dropdown, so it
behaves correctly regardless of the caller's surrounding layout (flex row,
card, etc.).

Props: `value`, `onChange`, `onSubmit` (fires on Enter when no suggestion is
keyboard-highlighted — preserves the existing "Enter submits search"
behavior), `suggestions: string[]`, `minChars` (default 2), `maxResults`
(default 8), `wrapperClassName`, `inputClassName`, `placeholder`.

Keyboard: `ArrowDown`/`ArrowUp` moves the active option (wraps around),
`Enter` selects the active option or calls `onSubmit`, `Escape` closes the
dropdown. Mouse click selects. `role="combobox"` / `aria-expanded` /
`aria-controls` / `aria-activedescendant` for basic screen-reader support.

Selecting a suggestion **fills the field only** — it does not auto-trigger
search. This matches the existing `JobTitleAutocomplete` precedent and avoids
yanking results away before the user has finished adjusting the other field
(e.g. picking a title, then still wanting to type a city).

## Integration points

- `/jobs` (`src/routes/jobs.tsx`): replace the two plain `<input>`s in the
  top search bar with `AutocompleteInput`, passing `suggestions={jobTitles}`
  / `suggestions={INDIAN_CITIES}`. Existing `form-input` classes preserved via
  `inputClassName`. No changes to filter state, routing, or the Supabase
  query — purely additive.
- Homepage hero (`src/routes/index.tsx`, `Hero` component): same swap for its
  two inputs, preserving the existing borderless-in-card styling via
  `inputClassName`/`wrapperClassName`.
- Job titles are loaded via a small hook (`useJobTitleSuggestions`) with a
  module-level cache, so both search bars share one fetch and don't refetch
  on navigation between them within the same page load.

## Out of scope

- No changes to the `FilterPanel` category/select-based filters.
- No changes to `job_titles_master` schema, `JobTitleAutocomplete.tsx`, or
  `searchJobTitles`/`addCustomJobTitle` server functions (candidate onboarding
  keeps its own auth-gated flow as-is).
- No changes to the (empty, unused) `cities` DB table.
