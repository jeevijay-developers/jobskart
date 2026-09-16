# P0-12 — Admin Controls

Expose every P0 parameter to platform admins so pricing, weights, and content can change without a deploy. Requires all previous prompts.

Existing admin routes: dashboard, users, companies, jobs, plans, credits, masters, verifications, resumes, banners, learning.

## 1. Plans (`/admin/plans`)
Editable form over `plans.limits` — not a raw JSON textarea. One labelled field per key:
`live_jobs_max` · `classic_posts_per_month` · `classic_plus_enabled` · `trending_posts_per_month` · `unlocks_per_job` · `boost_credits_per_month` · `recruiter_boost_cap_per_month` · `repost_allowed` · `response_retention_days`

Show which companies are on each plan. Changing a plan must **not** retroactively alter allowances on already-posted jobs — `job_unlock_allowance` rows are snapshots taken at post time. Warn about this on the edit screen.

## 2. Ranking weights (`/admin/masters` → Scoring)
Editable form over `match_scoring_config`: the four relevancy weights, tier bonuses, boost bonus and window, freshness bonus and half-life.

Include a **preview**: pick a real job and see the top 10 ranked results under both current and pending weights, side by side. Weight changes reorder the entire marketplace; shipping them blind is how a feed silently breaks.

## 3. JD library (`/admin/masters` → JD Library)
- CRUD on `jd_role_library` and `jd_skill_responsibilities`
- Bulk import from the client's xlsx format
- **Coverage report**: job titles used in live jobs with no library entry, ranked by posting frequency. This is the backlog that raises JD quality with no model work
- Preview: pick a title and skills, see the generated JD

## 4. Credits & plan settings (`/admin/credits`)
Editable `plan_settings`: `credits_per_unlock`, `free_post_enabled`, `free_response_cap`, `free_whatsapp_cap_per_post`, `free_whatsapp_rajasthan_only`, `free_validity_days`, `custom_plan_min_amount`, `spam_jobs_per_hour`. Plus credit pack CRUD.

**Manual credit grant** to any company, with a mandatory reason, logged to `credit_transactions` with `kind='admin_grant'`. Every manual grant must be attributable.

## 5. Job moderation (`/admin/jobs`)
- Queue filtered to `joining_fee_required = true` — joining-fee jobs are the highest fraud vector in this category and every one should be reviewed before going live
- Actions: approve, reject with reason, force-close, remove boost with refund
- Reports queue from `job_reports`
- Bulk actions on a company's jobs when a company is suspended

## 6. Masters (`/admin/masters`)
CRUD on `skills_master` (including a `synonyms` editor), `job_titles_master`, `job_categories`, `industries`, `cities`, `languages_master`, `candidate_assets_master`.

**Pending-review queue** for skills auto-created by AI during onboarding (`pending_review = true`): approve, merge into an existing skill, or reject. Without this queue the skills master degrades into near-duplicates within weeks, which quietly wrecks the 60% skill weight in the matching formula.

## 7. Dashboard (`/admin/dashboard`)
Add: jobs by tier, boosts today, unlocks today, allowance vs credit split, average broadening stage by city and category, verification queue depth, credit revenue this month, top 10 titles with no JD library entry.

Average broadening stage is the most useful number on this page: a city consistently reaching stage 3+ has a candidate supply problem, which is a business input, not just a metric.

## Acceptance
- [ ] Every P0 parameter is admin-editable with no deploy
- [ ] Ranking weight preview shows before/after ordering
- [ ] Plan changes do not alter existing jobs' allowances
- [ ] JD coverage report lists uncovered titles by frequency
- [ ] Manual credit grants require a reason and are logged
- [ ] Joining-fee jobs land in the moderation queue
- [ ] AI-created skills land in the pending-review queue
