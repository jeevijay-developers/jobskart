# AI Shortlist Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden and extend the existing `recommendShortlist` AI-scoring server function and its UI on `/employer/responses`, per the four refinements recommended in `docs/superpowers/specs/2026-09-16-ai-candidate-shortlisting-design.md`.

**Architecture:** No new files, no schema changes, no new mutation paths. All four refinements land inside the two files that already implement this feature (`src/lib/ai-shortlist.functions.ts`, `src/routes/_authenticated/employer/responses.tsx`), reusing the existing `application_ai_scores` cache table and the existing `askConfirm`/`confirmStatusChange`/`setStatus` status-change path (which already writes to `employer_activity` and fires notifications via a DB trigger — untouched by this plan).

**Tech Stack:** TanStack Start server functions, Supabase JS, Zod 4, `chatJSON()` from `src/lib/ai/provider.ts`, React 19.

## Global Constraints

- All AI calls go through `src/lib/ai/provider.ts` — this plan uses `chatJSON()`, already exported from that file. No new provider URLs or model names anywhere else.
- Recruiter-facing ranking stays server-side — no change to that; all scoring remains inside `recommendShortlist`, a TanStack server function.
- No schema/migration changes are required by this plan — `applications.cover_note`/`expected_salary`/`available_from` and `application_ai_scores` already exist.
- Status changes must keep going through the existing `setStatus()` → `applications` update → DB trigger (`tg_applications_after_update`) path, which already logs to `employer_activity` and sends notifications for `NOTIFY_STATUSES`. No parallel mutation is introduced.
- **This repo has no configured test runner** (confirmed: no `test` script in `package.json`, no vitest/jest config — per `CLAUDE.md`). Verification steps below use `tsc --noEmit`, `eslint`, and scratch Node scripts run from the OS temp directory (never committed) for pure-logic checks, plus explicit manual dev-server walkthroughs for anything touching Supabase/AI network calls or React state. This is the same verification bar used for prior UI changes in this repo.
- Package manager is `bun` per `CLAUDE.md`, but `bun` is not on PATH in this environment — use `./node_modules/.bin/eslint` and `./node_modules/.bin/tsc` directly (already confirmed present and working).

---

### Task 1: Replace manual JSON parsing with `chatJSON()` + a Zod schema

**Files:**
- Modify: `src/lib/ai-shortlist.functions.ts:1-4` (imports), `:94-132` (AI call + parsing + upsert building)

**Interfaces:**
- Consumes: `chatJSON<T>(args: ChatArgs, schema: ZodType<T>): Promise<T>` from `src/lib/ai/provider.ts` (already exists, already forces `json: true` and a JSON-only system suffix internally — do not pass `json: true` yourself).
- Produces: no change to `recommendShortlist`'s external signature or its `ScoreRow[]` return type — this task only changes how the AI response is parsed internally.

- [ ] **Step 1: Write a scratch script proving the current manual-parse code has no schema guarantee**

Create `C:\Users\user\AppData\Local\Temp\claude-scratch\parse-check.mjs` (adjust path to your own temp dir) with:

```js
// Demonstrates the bug this task fixes: a malformed AI reply silently
// produces garbage instead of a clear error.
const raw = '{"results":[{"application_id":123,"score":"high"}]}'; // wrong types, would slip through JSON.parse
const parsed = JSON.parse(raw);
console.log("Manual JSON.parse accepted invalid shape:", parsed);
```

Run: `node C:\Users\user\AppData\Local\Temp\claude-scratch\parse-check.mjs`
Expected: prints the object — proving `JSON.parse` alone doesn't validate `application_id` is a string or `score` is a number, which is exactly what the current code in `ai-shortlist.functions.ts:115-116` relies on.

- [ ] **Step 2: Add the Zod response schema**

In `src/lib/ai-shortlist.functions.ts`, immediately after the existing `input` schema (after line 10, before `type ScoreRow`), add:

```ts
const AiScoreResponse = z.object({
  results: z
    .array(
      z.object({
        application_id: z.string(),
        score: z.number(),
        reasons: z.array(z.string()).default([]),
        summary: z.string().optional(),
      }),
    )
    .default([]),
});
```

- [ ] **Step 3: Switch the import from `chat` to `chatJSON`**

Change line 4 from:
```ts
import { chat } from "@/lib/ai/provider";
```
to:
```ts
import { chatJSON } from "@/lib/ai/provider";
```

- [ ] **Step 4: Replace the manual call + parse block**

Replace this block (current lines 110–116):
```ts
      const raw = await chat({
        system: "You rank job candidates. Output only valid JSON.",
        user: prompt,
        json: true,
      });
      let parsed: { results?: Array<{ application_id: string; score: number; reasons?: string[]; summary?: string }> };
      try { parsed = JSON.parse(raw || "{}"); } catch { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim() || "{}"); }

```
with:
```ts
      const parsed = await chatJSON(
        {
          system: "You rank job candidates. Output only valid JSON.",
          user: prompt,
        },
        AiScoreResponse,
      );
```

- [ ] **Step 5: Simplify the upsert-building block now that `parsed.results` is guaranteed valid**

Replace this block (current lines 119–132):
```ts
      const upserts = (parsed.results || [])
        .filter((r) => r && r.application_id && needScoring.find((a) => a.id === r.application_id))
        .map((r) => {
          const app = needScoring.find((a) => a.id === r.application_id)!;
          return {
            job_id: jobId,
            application_id: r.application_id,
            candidate_id: app.candidate_id,
            score: Math.max(0, Math.min(100, Math.round(r.score || 0))),
            reasons: Array.isArray(r.reasons) ? r.reasons.slice(0, 5) : [],
            summary: r.summary?.slice(0, 200) || null,
            computed_at: new Date().toISOString(),
          };
        });
```
with:
```ts
      const upserts = parsed.results
        .filter((r) => r.application_id && needScoring.find((a) => a.id === r.application_id))
        .map((r) => {
          const app = needScoring.find((a) => a.id === r.application_id)!;
          return {
            job_id: jobId,
            application_id: r.application_id,
            candidate_id: app.candidate_id,
            score: Math.max(0, Math.min(100, Math.round(r.score || 0))),
            reasons: r.reasons.slice(0, 5),
            summary: r.summary?.slice(0, 200) || null,
            computed_at: new Date().toISOString(),
          };
        });
```

- [ ] **Step 6: Type-check and lint**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no new errors involving `ai-shortlist.functions.ts`.

Run: `./node_modules/.bin/eslint src/lib/ai-shortlist.functions.ts`
Expected: no new errors beyond the pre-existing repo-wide CRLF/`prettier/prettier` noise (confirmed pre-existing across this repo, unrelated to this change).

- [ ] **Step 7: Manual verification via dev server**

Run: `./node_modules/.bin/vite dev` (or your usual `bun run dev` once available), open `/employer/responses`, pick a job with at least one applicant, open the "AI shortlist" tab. Confirm score cards still render with a score, summary, and reasons. Click "Re-rank" and confirm it still refreshes without error. Note the one intentional behavior change from this task: if the AI ever returns a malformed shape, the tab now shows a `toast.error` (via the existing `catch` in `loadAi`) instead of silently caching all-zero scores — this is a deliberate improvement (fail loud, not fail silent-and-wrong), and doesn't block the Inbox tab, which is unaffected.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai-shortlist.functions.ts
git commit -m "Use chatJSON with a Zod schema for AI shortlist scoring"
```

---

### Task 2: Feed application form answers into the scoring prompt

**Files:**
- Modify: `src/lib/ai-shortlist.functions.ts:49-54` (applications query), `:81-92` (per-candidate item builder), `:94-108` (prompt template)

**Interfaces:**
- Consumes: `needScoring` array built from the `apps` query result (Task 1 unaffected).
- Produces: no external signature change — `cover_note`/`expected_salary`/`available_from` become additional prompt context only, explicitly called out in the prompt as *not* part of the fixed numeric weighting, so the existing documented formula (skill 50% / experience 25% / role 15% / location 10%) is preserved rather than silently redefined.

- [ ] **Step 1: Extend the applications query to select the form-answer columns**

Replace (current lines 49–54):
```ts
    const { data: apps } = await supabase
      .from("applications")
      .select("id, candidate_id, status, created_at, profiles!candidate_id (full_name, city, avatar_url)")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(50);
```
with:
```ts
    const { data: apps } = await supabase
      .from("applications")
      .select(
        "id, candidate_id, status, created_at, cover_note, expected_salary, available_from, profiles!candidate_id (full_name, city, avatar_url)",
      )
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(50);
```

- [ ] **Step 2: Include the new fields in the per-candidate prompt item**

Replace (current lines 81–92):
```ts
      const items = needScoring.map((a) => {
        const p = profileMap.get(a.candidate_id);
        return {
          application_id: a.id,
          candidate_id: a.candidate_id,
          headline: p?.headline ?? null,
          last_role: p?.last_role ?? null,
          years_experience: p?.years_experience ?? null,
          skills: p?.skills ?? [],
          bio: (p?.bio ?? "").slice(0, 300),
        };
      });
```
with:
```ts
      const items = needScoring.map((a) => {
        const p = profileMap.get(a.candidate_id);
        const app = a as unknown as {
          cover_note: string | null;
          expected_salary: number | null;
          available_from: string | null;
        };
        return {
          application_id: a.id,
          candidate_id: a.candidate_id,
          headline: p?.headline ?? null,
          last_role: p?.last_role ?? null,
          years_experience: p?.years_experience ?? null,
          skills: p?.skills ?? [],
          bio: (p?.bio ?? "").slice(0, 300),
          cover_note: (app.cover_note ?? "").slice(0, 400),
          expected_salary: app.expected_salary ?? null,
          available_from: app.available_from ?? null,
        };
      });
```

- [ ] **Step 3: Tell the model how to use the new fields without changing the numeric formula**

Replace (current lines 94–108):
```ts
      const prompt = `Score each candidate 0-100 against this job. Return strict JSON only:
{"results":[{"application_id":"...","score":85,"reasons":["..."],"summary":"one line"}]}

JOB
Title: ${job.title}
Skills required: ${(job.skills || []).join(", ") || "n/a"}
Min experience: ${job.min_experience_years ?? 0} years
City: ${job.city ?? "any"}
Description: ${(job.description || "").slice(0, 800)}

CANDIDATES
${JSON.stringify(items)}

Scoring: skill overlap 50%, experience fit 25%, role/title relevance 15%, location 10%.
Give 2-4 short bullet reasons each. Be honest — low scores when off-target.`;
```
with:
```ts
      const prompt = `Score each candidate 0-100 against this job. Return strict JSON only:
{"results":[{"application_id":"...","score":85,"reasons":["..."],"summary":"one line"}]}

JOB
Title: ${job.title}
Skills required: ${(job.skills || []).join(", ") || "n/a"}
Min experience: ${job.min_experience_years ?? 0} years
City: ${job.city ?? "any"}
Description: ${(job.description || "").slice(0, 800)}

CANDIDATES
${JSON.stringify(items)}

Each candidate also includes cover_note, expected_salary and available_from from their
application form. Use these only as supporting context in your reasons/summary (e.g. flag
a mismatched expected salary or a relevant point from their cover note) — they are NOT
part of the numeric formula below.

Scoring: skill overlap 50%, experience fit 25%, role/title relevance 15%, location 10%.
Give 2-4 short bullet reasons each. Be honest — low scores when off-target.`;
```

- [ ] **Step 4: Type-check and lint**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no new errors.

Run: `./node_modules/.bin/eslint src/lib/ai-shortlist.functions.ts`
Expected: no new errors beyond the pre-existing CRLF noise.

- [ ] **Step 5: Manual verification via dev server**

Find or create a test application with a distinctive `cover_note` (e.g. "Available immediately, open to relocate") and an `expected_salary` clearly above the job's `max_salary`. Open the AI shortlist tab for that job, click "Re-rank" (bypasses the 1-hour cache), and confirm the candidate's `reasons`/`summary` at least sometimes reflects that context (AI output isn't deterministic — check across a couple of re-ranks if the first one doesn't mention it). Confirm the score still falls within 0–100 and the tab doesn't error.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai-shortlist.functions.ts
git commit -m "Feed application form answers into AI shortlist scoring context"
```

---

### Task 3: Guard against protected-characteristic job fields ever reaching the AI prompt

**Files:**
- Create: `src/lib/ai-shortlist-guard.ts`
- Modify: `src/lib/ai-shortlist.functions.ts:34-39` (job query + fetch)

**Interfaces:**
- Produces: `PROTECTED_JOB_FIELDS: readonly string[]` and `assertNoProtectedFields(job: Record<string, unknown>): void` (throws if any protected field key is present) from the new file.
- Consumes (in `ai-shortlist.functions.ts`): calls `assertNoProtectedFields(job)` right after the existing `if (!job) throw new Error("Job not found");` check.

- [ ] **Step 1: Write the failing scratch test**

Create `src/lib/ai-shortlist-guard.scratch-check.ts` — same folder as the module under test, so the import path is stable regardless of where you run `node` from. This file is never staged/committed (deleted in Step 8):

```ts
import { assertNoProtectedFields } from "./ai-shortlist-guard.ts";

let threw = false;
try {
  assertNoProtectedFields({ title: "Sales Associate", age_min: 18 });
} catch {
  threw = true;
}
if (!threw) throw new Error("FAIL: expected assertNoProtectedFields to throw when age_min is present");

assertNoProtectedFields({ title: "Sales Associate", skills: ["excel"] });
console.log("PASS");
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node src/lib/ai-shortlist-guard.scratch-check.ts`
Expected: FAIL — module not found, because `src/lib/ai-shortlist-guard.ts` doesn't exist yet.

- [ ] **Step 3: Create the guard module**

Create `src/lib/ai-shortlist-guard.ts`:

```ts
export const PROTECTED_JOB_FIELDS = ["age_min", "age_max", "gender_pref"] as const;

// These are candidate-search filters, not fit signals — never let them reach the AI prompt.
export function assertNoProtectedFields(job: Record<string, unknown>) {
  for (const field of PROTECTED_JOB_FIELDS) {
    if (field in job) {
      throw new Error(`recommendShortlist: "${field}" must never reach the AI prompt.`);
    }
  }
}
```

- [ ] **Step 4: Run the scratch test again and confirm it passes**

Run: `node src/lib/ai-shortlist-guard.scratch-check.ts`
Expected: prints `PASS`.

- [ ] **Step 5: Wire the guard into `recommendShortlist`**

In `src/lib/ai-shortlist.functions.ts`, add the import near the top (after the existing imports, e.g. after line 4):
```ts
import { assertNoProtectedFields } from "@/lib/ai-shortlist-guard";
```

Then replace (current lines 34–39):
```ts
    const { data: job } = await supabase
      .from("jobs")
      .select("id, company_id, title, description, skills, min_experience_years, city")
      .eq("id", jobId)
      .maybeSingle();
    if (!job) throw new Error("Job not found");
```
with:
```ts
    const { data: job } = await supabase
      .from("jobs")
      // Never add age_min/age_max/gender_pref here — see assertNoProtectedFields below.
      .select("id, company_id, title, description, skills, min_experience_years, city")
      .eq("id", jobId)
      .maybeSingle();
    if (!job) throw new Error("Job not found");
    assertNoProtectedFields(job);
```

- [ ] **Step 6: Type-check and lint**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no new errors.

Run: `./node_modules/.bin/eslint src/lib/ai-shortlist-guard.ts src/lib/ai-shortlist.functions.ts`
Expected: no new errors beyond pre-existing CRLF noise.

- [ ] **Step 7: Manual verification via dev server**

Open the AI shortlist tab for any job as in Task 1/2 and confirm it still loads normally (the guard should be silently satisfied since the select never included the protected fields — this step confirms the added call doesn't break the happy path).

- [ ] **Step 8: Delete the scratch test file**

Run: `rm src/lib/ai-shortlist-guard.scratch-check.ts` (never staged/committed — confirm `git status` shows it gone before the commit in Step 9).

- [ ] **Step 9: Commit**

```bash
git add src/lib/ai-shortlist-guard.ts src/lib/ai-shortlist.functions.ts
git commit -m "Add runtime guard against protected job fields reaching the AI prompt"
```

---

### Task 4: Add a "Shortlist top N" bulk control to the AI tab

**Files:**
- Modify: `src/routes/_authenticated/employer/responses.tsx:101` (type), `:112-116` (state), `:212-216` (memo), `:240-255` (askConfirm/confirmStatusChange), `:447-455` (AI tab header controls), `:508-521` (Inbox dropdown call sites), `:597-613` (AI row button call sites), `:630-639` (AlertDialog copy)

**Interfaces:**
- Consumes: `applicantStatusLabel(status: string): string` (existing, `@/lib/applicantStatus`), `setStatus(ids: string[], status: string): Promise<void>` (existing, already accepts an array — no change needed there).
- Produces: `askConfirm(ids: string[], names: Array<string | null | undefined>, status: string): void` — **signature change** from the current `askConfirm(id: string, name, status)`. Every existing call site must be updated in this task (there are 6: 3 in the Inbox row dropdown, 3 in the AI tab row buttons).

- [ ] **Step 1: Generalize `PendingStatusChange` and `askConfirm`/`confirmStatusChange` to arrays**

Replace (current line 101):
```ts
type PendingStatusChange = { id: string; name: string; status: string; label: string };
```
with:
```ts
type PendingStatusChange = { ids: string[]; names: string[]; status: string; label: string };
```

Replace (current lines 240–255):
```ts
  const askConfirm = (id: string, name: string | null | undefined, status: string) => {
    setPending({
      id,
      name: name || "this candidate",
      status,
      label: applicantStatusLabel(status),
    });
  };

  const confirmStatusChange = async () => {
    if (!pending) return;
    setPendingBusy(true);
    await setStatus([pending.id], pending.status);
    setPendingBusy(false);
    setPending(null);
  };
```
with:
```ts
  const askConfirm = (ids: string[], names: Array<string | null | undefined>, status: string) => {
    setPending({
      ids,
      names: names.map((n) => n || "this candidate"),
      status,
      label: applicantStatusLabel(status),
    });
  };

  const confirmStatusChange = async () => {
    if (!pending) return;
    setPendingBusy(true);
    await setStatus(pending.ids, pending.status);
    setPendingBusy(false);
    setPending(null);
  };

  const shortlistTopN = () => {
    const top = eligibleAiRows.slice(0, shortlistN);
    if (!top.length) return;
    askConfirm(
      top.map((r) => r.application_id),
      top.map((r) => r.full_name),
      "shortlisted",
    );
  };
```

- [ ] **Step 2: Update the Inbox dropdown call sites**

Replace (current lines 508, 513, 518 — inside the Inbox row's `DropdownMenuItem`s):
```ts
                        <DropdownMenuItem
                          onClick={() => askConfirm(r.id, r.profiles?.full_name, "shortlisted")}
                        >
```
```ts
                        <DropdownMenuItem
                          onClick={() => askConfirm(r.id, r.profiles?.full_name, "interview")}
                        >
```
```ts
                        <DropdownMenuItem
                          onClick={() => askConfirm(r.id, r.profiles?.full_name, "rejected")}
                        >
```
with:
```ts
                        <DropdownMenuItem
                          onClick={() => askConfirm([r.id], [r.profiles?.full_name], "shortlisted")}
                        >
```
```ts
                        <DropdownMenuItem
                          onClick={() => askConfirm([r.id], [r.profiles?.full_name], "interview")}
                        >
```
```ts
                        <DropdownMenuItem
                          onClick={() => askConfirm([r.id], [r.profiles?.full_name], "rejected")}
                        >
```

- [ ] **Step 3: Update the AI row button call sites**

Replace (current lines 597, 603, 609):
```ts
                          onClick={() => askConfirm(r.application_id, r.full_name, "shortlisted")}
```
```ts
                          onClick={() => askConfirm(r.application_id, r.full_name, "interview")}
```
```ts
                          onClick={() => askConfirm(r.application_id, r.full_name, "rejected")}
```
with:
```ts
                          onClick={() => askConfirm([r.application_id], [r.full_name], "shortlisted")}
```
```ts
                          onClick={() => askConfirm([r.application_id], [r.full_name], "interview")}
```
```ts
                          onClick={() => askConfirm([r.application_id], [r.full_name], "rejected")}
```

- [ ] **Step 4: Add `shortlistN` state and the `eligibleAiRows` memo**

Add state (after the existing `const [aiLoading, setAiLoading] = useState(false);` at line 113):
```ts
  const [shortlistN, setShortlistN] = useState(10);
```

Add the memo (after the existing `filteredAiRows` memo, current lines 212–216):
```ts
  const eligibleAiRows = useMemo(
    () => filteredAiRows.filter((r) => r.status === "applied"),
    [filteredAiRows],
  );
```

- [ ] **Step 5: Add the "Shortlist top N" control next to "Re-rank"**

Replace (current lines 447–455):
```ts
        ) : (
          <button
            onClick={() => loadAi(true)}
            disabled={!jobFilter || aiLoading}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-primary bg-primary-light px-3 text-sm font-semibold text-primary disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${aiLoading ? "animate-spin" : ""}`} /> Re-rank
          </button>
        )}
```
with:
```ts
        ) : (
          <>
            <button
              onClick={() => loadAi(true)}
              disabled={!jobFilter || aiLoading}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-primary bg-primary-light px-3 text-sm font-semibold text-primary disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${aiLoading ? "animate-spin" : ""}`} /> Re-rank
            </button>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={50}
                value={shortlistN}
                onChange={(e) => setShortlistN(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                className="form-input h-10 w-16 text-center text-sm"
                aria-label="Number of candidates to shortlist"
              />
              <button
                onClick={shortlistTopN}
                disabled={!jobFilter || aiLoading || eligibleAiRows.length === 0}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-success px-3 text-sm font-semibold text-success-foreground disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Shortlist top {shortlistN}
              </button>
            </div>
          </>
        )}
```

- [ ] **Step 6: Update the AlertDialog copy to handle both single and bulk confirms**

Replace (current lines 630–639):
```ts
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move {pending?.name} to {pending?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This updates the candidate's application status right away. You can change it again
              later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
```
with:
```ts
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending && pending.ids.length > 1
                ? `Move ${pending.ids.length} candidates to ${pending.label}?`
                : `Move ${pending?.names[0]} to ${pending?.label}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending && pending.ids.length > 1
                ? `${pending.names.slice(0, 5).join(", ")}${
                    pending.names.length > 5 ? ` and ${pending.names.length - 5} more` : ""
                  } — this updates their application status right away. You can change it again later if needed.`
                : "This updates the candidate's application status right away. You can change it again later if needed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
```

- [ ] **Step 7: Type-check and lint**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors referencing `responses.tsx` (this is the step that catches any missed call site from Steps 2–3 — a leftover single-argument `askConfirm(r.id, ...)` call will now fail type-checking since the signature changed).

Run: `./node_modules/.bin/eslint src/routes/_authenticated/employer/responses.tsx`
Expected: no new errors beyond pre-existing CRLF noise.

- [ ] **Step 8: Manual verification via dev server**

On `/employer/responses`, AI tab, for a job with 2+ applicants still in `applied` status:
1. Confirm the "Shortlist top N" input defaults to 10 and the button is enabled.
2. Set N to 1, click "Shortlist top N" — confirm the dialog shows a single-candidate message (not the "N candidates" plural wording).
3. Cancel, then set N to 2 (or however many eligible applicants exist), click again — confirm the dialog now shows the plural "Move N candidates to Shortlisted?" wording with names listed.
4. Confirm — verify the rows update to "Shortlisted" status, the Inbox tab reflects the same statuses, and no console errors appear.
5. Re-test a single-row Shortlist/Interview/Reject click (both Inbox dropdown and AI tab row buttons) to confirm the generalized `askConfirm` didn't regress the existing single-candidate flow.

- [ ] **Step 9: Commit**

```bash
git add src/routes/_authenticated/employer/responses.tsx
git commit -m "Add bulk 'Shortlist top N' control to the AI shortlist tab"
```

---

## Self-Review Notes

- **Spec coverage:** all four refinements from the design doc have a task — Task 1 (chatJSON/Zod), Task 2 (form answers in prompt), Task 3 (protected-field guard), Task 4 (Shortlist top N UI). The design doc's other two lower-priority notes (resume-text re-fetch, 50-applicant cap notice) were explicitly marked out of scope in that doc and are not tasks here.
- **Type consistency:** `askConfirm`'s new signature (`ids: string[], names: Array<string | null | undefined>, status: string`) is used identically across all 6 call sites in Task 4 and in the new `shortlistTopN` helper. `PendingStatusChange.ids`/`.names` are consumed consistently in `confirmStatusChange` and the AlertDialog JSX.
- **No placeholders:** every step above contains the literal code to write, not a description of it.
