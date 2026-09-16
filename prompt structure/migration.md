# JobsKart — Migration Plan (Lovable → Jeevijay Supabase)

**Timing:** after P0 is complete, before real user data enters the system.
**Advantage of pre-launch:** no `auth.users` to preserve. This is the single hardest part of any Supabase migration and we get to skip it entirely — but only if we move before launch. That deadline is real.

---

## 1. What is coupled to Lovable today

| Coupling | File(s) | Migration action |
|---|---|---|
| Cloud Auth shim | `src/integrations/lovable/index.ts` | Delete. Replace with native `supabase.auth` OAuth |
| AI gateway | `resume.functions.ts`, `ai-shortlist.functions.ts`, `matching.functions.ts` | Already behind `src/lib/ai/provider.ts` if R1 was followed → one env var change |
| Error reporting | `src/lib/lovable-error-reporting.ts` | Replace with Sentry or drop |
| Generated Supabase client | `src/integrations/supabase/client.ts` | Regenerate against new project; remove the "Connect Supabase in Lovable Cloud" error string |
| Vite config plugin | `@lovable.dev/vite-tanstack-config` | Replace with standard TanStack Start Vite config |
| `AGENTS.md` sync notice | root | Delete after disconnecting |
| Committed `.env` | root | Remove from git history before any service-role key exists |

Everything else — routes, components, server functions, migrations, RLS, RPCs — is standard and moves untouched.

---

## 2. Data export without `pg_dump`

Lovable Cloud does not expose `pg_dump` or a direct Postgres connection string.

**Preferred method: service-role reads.** RLS is bypassed by the service-role key, so no policy changes are needed. Script it:

```ts
// scripts/export.ts  — run with the OLD project's service-role key
const TABLES = ["cities","industries","job_categories","job_titles_master",
  "skills_master","languages_master","candidate_assets_master","plans",
  "plan_settings","credit_packs","match_scoring_config","learning_resources",
  "promo_banners","jd_role_library","jd_skill_responsibilities"];

for (const t of TABLES) {
  let from = 0; const page = 1000; const rows: any[] = [];
  for (;;) {
    const { data, error } = await admin.from(t).select("*").range(from, from + page - 1);
    if (error) throw error;
    rows.push(...data); if (data.length < page) break; from += page;
  }
  await Bun.write(`export/${t}.json`, JSON.stringify(rows, null, 2));
}
```

**Fallback if no service-role key is available:** temporarily add permissive `SELECT` policies for an authenticated admin user, export, then drop them. Prefer adding a policy over `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` — a policy you forget to drop is far less dangerous than RLS you forget to re-enable, and it is easy to audit (`SELECT * FROM pg_policies WHERE policyname LIKE 'tmp_export%'`).

**Do not migrate:** test candidates, test companies, test jobs, test applications, credit transactions, invoices, activity logs. Launch clean. The only data that matters is masters and configuration.

---

## 3. Sequence

**Phase 1 — Prepare (while still on Lovable)**
1. `.env` → `.gitignore`, `git rm --cached .env`, add `.env.example`
2. Implement `src/lib/ai/provider.ts`; refactor the three AI call sites
3. Confirm every schema change of P0 exists as a file in `supabase/migrations/`
4. Obtain Gemini or OpenAI API key directly
5. Run the export script; commit `export/*.json` to a private location (not the repo)

**Phase 2 — Stand up the new project**
6. Create the Supabase project in Jeevijay's org (region: Mumbai `ap-south-1`)
7. `supabase link` → `supabase db push` — all 28+ migrations replay in order
8. Verify: table count, enum count, RPC count, and `pg_policies` count match the old project
9. Configure Auth: phone OTP provider (MSG91 / Twilio), Google OAuth credentials, redirect URLs, JWT expiry
10. Create Storage buckets (resumes, company documents, banners) with matching policies
11. Import masters from `export/*.json`

**Phase 3 — Cut over**
12. Point `.env` at the new project (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`)
13. Remove the Lovable auth shim; wire native OAuth + phone OTP
14. Swap `AI_PROVIDER` to the direct provider
15. Deploy to Vercel/Netlify/Node from GitHub. TanStack Start builds to a Nitro server — this is a standard Node deployment, not a static SPA
16. Point the production domain at the new host
17. Re-register the Razorpay webhook URL and re-verify the signature secret

**Phase 4 — Verify before opening signups**
18. Full smoke test of all three portals against the checklist below
19. Disconnect the repo from Lovable, delete `AGENTS.md` sync block
20. Keep the Lovable project read-only for 30 days as a rollback reference, then delete

---

## 4. Verification checklist

| Area | Test |
|---|---|
| Auth | Phone OTP signup, Google OAuth, password reset, invite acceptance |
| RLS | Candidate A cannot read Candidate B's profile; Company A cannot read Company B's jobs, unlocks, or activity |
| RPCs | Every `SECURITY DEFINER` function exists and has correct `search_path` |
| Storage | Resume upload, signed-URL download, unauthorised access denied |
| Credits | Purchase → Razorpay webhook → wallet credited → invoice generated with correct FY number |
| Unlock | Allowance path, wallet fallback, free repeat-unlock, allowance exhaustion error |
| Boost | Same-day rejection, credit deduction, decay in ranking |
| AI | Resume parse (PDF text, PDF scan, DOCX, image), shortlist, match score |
| Search | Job-gated access, broadening ladder, masked fields absent from the network response |
| Webhooks | Razorpay signature verification against the new secret |
| MCP | All 7 tools respond against the new project |

**Test 3 twice.** Open the browser network tab during a candidate DB search and confirm no phone number, email, or resume URL appears in any response payload for a locked candidate. This is the one failure that cannot be walked back after launch.

---

## 5. Rollback

Until step 20, rollback is a single env-var revert plus a redeploy. Keep both projects alive and both key sets to hand throughout Phase 3. Do not delete anything on the Lovable side until the new project has served real traffic for 30 days.

---

## 6. Post-migration hardening

- Enable Point-in-Time Recovery on the new project
- Set up daily `pg_dump` to S3 — now possible, since you own the project
- Enable Supabase log drains
- Rotate every key that was ever committed to the repo
- Add a staging project mirroring production; run migrations there first from this point on
