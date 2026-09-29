# Learning & Content Ecosystem — Implementation Plan

Source spec: product flow diagram — `Learning CMS → Blogs → Career Content Feed → Training Modules → Certification Marketplace → Content Recommendation Engine`. This plan turns that flow into buildable phases against the current JobsKart schema, reusing existing primitives (skill engine, Razorpay, admin patterns) instead of rebuilding them.

## 1. How other job portals do it (reference patterns)

| Portal | What they ship | Pattern worth stealing |
|---|---|---|
| **LinkedIn Learning** | Courses keyed to *skills*; job posts list required skills; "members viewing this job also took…"; certificates attach to profile as badges | Skill is the join key between jobs, learning and recommendations. Certificates = profile signal, not just a PDF |
| **Indeed Career Guide** | Huge public SEO blog hub organised by career questions & job families; every article deep-links into a job search | Content is an *acquisition funnel*: public, indexable, category-mapped, always one click from `/jobs` |
| **Naukri FastForward / Learning** | Paid certification courses (first-party + partners), resume services; certs add a verified badge to the candidate profile | Monetise the *credential*, keep advice content free |
| **Internshala Trainings** | Low-price (₹199–₹1999) project-based trainings bundled with internships; certificate on completion; partner marketplace | Price anchor for Indian market; bundle learning with the core product (applications) |
| **Coursera / Google Career Certificates** | Employer-recognised certificates; job posts say "certificate preferred"; assessment-gated issuance | Assessment + pass mark + unique certificate number = trust; employer-side visibility of certs |

**Synthesis for JobsKart:** one content pipeline (CMS) feeding three surfaces (public SEO blogs, candidate learning hub, feed), where **skills/tags are the join key** to jobs, completion produces a **profile-visible credential**, and a **skill-gap-first recommender** closes the loop back into applications. Monetisation: blogs free (SEO), course previews free, **certifications paid** via the existing Razorpay stack (candidate-scoped).

## 2. Current state (audit, 2026-09-28)

**Already exists:**
- `learning_resources` table (`supabase/migrations/20260623052758_*.sql:166-186`): `title, slug UNIQUE, description, cover_url, content_url (external link only), kind CHECK('video','article'), category (free text), is_published`. RLS: public read published; `has_platform_role(uid,'super_admin')` write.
- `src/routes/admin/learning.tsx`: minimal CRUD (add/toggle-publish/delete), **no edit**, no rich body, no drafts, external URLs only.
- Surfaces: latest 3 published resources on candidate dashboard (`_authenticated/candidate/dashboard.tsx:105-109`) and employer dashboard (`:190`).
- `AdminShell` sidebar already links `/admin/learning` (GraduationCap icon).

**Missing entirely:** blogs/body content, courses/modules/lessons, enrollments & progress, certifications/assessments/certificates, candidate-side payments, content analytics, recommendation, `/learn` public routes, sitemap/robots/JSON-LD (no SEO infra at all today — `jobs.$jobId.tsx:45` has static title only).

**Reusable primitives:**
- Skill taxonomy: `ROLE_SKILL_SUGGESTIONS` (26 role families, `src/lib/options.ts:94`), `suggestSkillsForRoles` (`:130`), `getRecommendedSkills` (`src/lib/skill-engine.ts:27`) — the tagging + skill-gap backbone.
- Payments: `src/lib/credits.functions.ts` (createRazorpayOrder/verify/webhook pattern), `src/lib/razorpay.server.ts`, webhook route `src/routes/api/public/webhooks/razorpay` — **employer-scoped today**; candidate flow needs a parallel candidate-scoped order table + quote RPC.
- Server fns: `createServerFn().middleware([requireSupabaseAuth]).validator(zod)` convention.
- Admin: `masters.tsx` spec-driven tabs pattern; `has_platform_role` gating.
- Storage pattern: private buckets + `auth.uid()` folder prefix + signed URLs; `avatars` public via `getPublicUrl`.
- PDF: `src/lib/invoice-pdf.ts` (company-oriented) — pattern for certificate PDFs.

**Constraints (CLAUDE.md / AGENTS.md):** money logic in Postgres SECURITY DEFINER RPCs with row locks; RLS on everything; one commit per phase, main always working, no history rewrites (Lovable sync). Migrations are written locally and pushed by the user (no DB credentials in CI/agent env — same as boost/salary/expiry plans).

## 3. Design decisions

1. **Content model — three tables, not one blob.** `content_posts` (blogs/SEO), `courses` + `course_lessons` (training modules), `certifications` + `cert_questions` (marketplace). Shared shape: `slug UNIQUE, title, excerpt, cover_url, category (FK-ish text to JOB_CATEGORIES), tags text[] (skills), status ('draft','published','archived'), published_at, views_count`. `learning_resources` is **frozen** (legacy external links keep working) and superseded; admin UI migrates to the new CMS.
2. **Skills/tags are the join key.** `tags text[]` on every content row draws from `ROLE_SKILL_SUGGESTIONS`/job skills so the recommender and job↔content cross-links work without ML. Admin gets a tag autocomplete fed by the same taxonomy.
3. **Body format = Markdown** stored in `body_md text`; rendered client-side with a pinned markdown lib + `rehype-sanitize`-style allowlist (no raw HTML → no stored XSS). Video lessons store a YouTube/URL embed id, **never host video** (storage/bandwidth out of scope).
4. **Statuses & scheduling:** `status` + `published_at`; public queries filter `status='published' AND published_at <= now()`. Scheduled publishing = just a future `published_at` (no cron needed).
5. **Candidate payments (new, candidate-scoped):** `candidate_orders` (razorpay_order_id UNIQUE, amount_inr, item_kind 'certification', item_id, status created|paid|failed) + SECURITY DEFINER `create_candidate_cert_order(_cert_id)` returning the quote, and webhook verify inserts `cert_purchases` **only once** (UNIQUE(user,cert) + idempotent webhook). Reuses `razorpay.server.ts`; GST invoice out of scope for individuals (v1).
6. **Certificates:** on passing assessment (score ≥ pass mark, attempts ≤ max_attempts) insert `certificates(user_id, cert_id, cert_no UNIQUE default slug-ish sequence, issued_at, pdf_url)`; PDF generated server-side (invoice-pdf pattern) into `content-media` bucket; certificate number verifiable on a **public** route `/verify/certificate/$certNo` (trust signal, employer-facing).
7. **Recommendation = deterministic SQL RPC, no ML.** `recommend_content(_user_id, _limit)` score:
   `3 × |tags ∩ skill_gap| + 1 × |tags ∩ profile_skills| + 2 × collab + freshness(7d decay) + log1p(views)/10`
   where `skill_gap = suggestSkillsForRoles(interested_roles) − profile.skills` (computed in RPC from `candidate_profiles` + `jobs` categories applied to), `collab` = co-enrollment/co-view count with candidates sharing ≥1 applied job (from `content_events`), freshness from `published_at`. Cold start (no profile/apps) → popularity + category match. All weights in a `content_settings` singleton jsonb (admin-tunable, mirrors `boost_settings`).
8. **Analytics as the fuel:** `content_events(user_id NULL, kind 'post'|'course'|'cert', item_id, event 'view'|'enroll'|'complete'|'purchase'|'pass', created_at)` appended by server fns. Powers popularity, collaborative term, and the admin tier-performance-style table.
9. **SEO:** public routes under `/learn` with per-page `head()` meta + JSON-LD (`Article`, `Course`, `ItemList`), `/sitemap.xml` + `/robots.txt` generated routes listing published posts/courses/certs + jobs; canonical URLs; category landing pages `/learn/category/$cat` deep-linking `/jobs?category=`.
10. **Feed:** authenticated candidate feed = `recommend_content` output rendered as mixed cards (post/course/cert) with reason chips ("Matches your Sales skill gap"); public `/learn` shows editorial (featured + newest). Feed lives on `/learn` home + candidate dashboard strip.
11. **Storage:** new **public** bucket `content-media` (covers/thumbnails/cert PDFs): world-read, write only via service-role server fns (admin uploads, cert PDF writer). No user-folder prefix needed since writes are server-side.
12. **No new auth surfaces:** learners = existing candidates; authors = super_admin only (v1). Multi-author/editorial roles out of scope.

## 4. Schema (single migration, Phase 1)

```
content_posts(id, slug uq, title, excerpt, body_md, cover_url, category, tags[], status, featured bool,
              published_at, seo_title, seo_description, views_count, created_by, created_at, updated_at)
courses(id, slug uq, title, excerpt, description_md, cover_url, category, tags[], status, featured,
        level 'beginner'|'intermediate'|'advanced', duration_minutes int, price_inr int NOT NULL DEFAULT 0,
        published_at, views_count, enrollments_count, created_at, updated_at)
course_lessons(id, course_id FK CASCADE, position int, title, kind 'video'|'reading'|'quiz',
               video_url, body_md, quiz jsonb, free_preview bool, duration_minutes)
certifications(id, slug uq, title, excerpt, description_md, cover_url, category, tags[], status,
               price_inr NOT NULL DEFAULT 0, provider 'first_party'|'partner', partner_name,
               pass_mark int, max_attempts int, validity_months int NULL, questions jsonb,
               published_at, views_count, created_at, updated_at)
course_enrollments(id, user_id FK auth.users CASCADE, course_id FK CASCADE, enrolled_at, completed_at,
                   UNIQUE(user_id, course_id))
lesson_progress(id, user_id, lesson_id FK CASCADE, completed_at, UNIQUE(user_id, lesson_id))
candidate_orders(id, user_id, item_kind 'certification', item_id, amount_inr, razorpay_order_id uq,
                 razorpay_payment_id, status 'created'|'paid'|'failed', created_at, updated_at)
cert_purchases(id, user_id, cert_id, order_id NULL (NULL = free), amount_inr, created_at, UNIQUE(user_id, cert_id))
cert_attempts(id, user_id, cert_id, score int, passed bool, attempted_at)
certificates(id, user_id, cert_id, cert_no uq, issued_at, pdf_url, UNIQUE(user_id, cert_id))
content_events(id, user_id NULL, kind 'post'|'course'|'cert', item_id uuid, event text, created_at)
   + indexes: (kind, item_id, created_at DESC), (user_id, created_at DESC)
content_settings(id=1 singleton, weights jsonb, updated_at)
storage bucket content-media (public read; no direct client write policy)
```
RLS: published content `SELECT` to anon/authenticated (`status='published' AND published_at<=now()`); drafts/archived + all writes via super_admin or SECURITY DEFINER server fns; learner tables owner-read (`auth.uid()=user_id`) + super_admin; `candidate_orders/cert_purchases` owner-read; inserts only via DEFINER RPCs (money path). Partial indexes `(status, published_at DESC) WHERE status='published'` per content table; `content_events` BRIN-ish `(created_at DESC)`.

## 5. Phases

### Phase 1 — Schema, storage, settings (S)
Migration above + regenerate `types.ts` (hand-edit until push, repo convention). Seed `content_settings` weights + 2–3 sample published posts/courses via seed block guarded by `WHERE NOT EXISTS`.
**Acceptance:** migration applies on a scratch DB; public anon select returns only published rows; learner tables invisible across users.

### Phase 2 — Learning CMS (admin content studio) (M)
Rebuild `src/routes/admin/learning.tsx` into tabbed studio (posts / courses / certifications), reusing `masters.tsx` spec-driven patterns:
- List per type with status chips, feature toggle, views count; edit-in-place (current page can't edit).
- Post editor: title→slug auto, excerpt, markdown body with live preview, tag autocomplete (ROLE_SKILL_SUGGESTIONS + free text), category select (JOB_CATEGORIES), cover upload → `content-media` via server fn, SEO fields, status + publish date.
- Course builder: meta + ordered lesson list (add/reorder/delete; kind video/reading/quiz; free_preview flag).
- Certification builder: meta, price, pass mark/attempts/validity, question bank editor (question, options[4], correct idx, explanation) stored in `questions jsonb`.
- Server fns `content.functions.ts`: `savePost/saveCourse/saveCert/uploadContentMedia` (zod-validated, super_admin-gated, service-role writes).
**Acceptance:** admin can author+publish a post, a 3-lesson course, and a 5-question cert without touching SQL; drafts invisible publicly.

### Phase 3 — Public content hub + blogs + SEO (M)
- Routes: `/learn` (hub: featured + newest posts/courses/certs), `/learn/blog`, `/learn/blog/$slug`, `/learn/category/$category`, `/sitemap.xml`, `/robots.txt`.
- Article page: rendered markdown (sanitized), cover, category chip → `/jobs?category=`, related jobs strip (same category, `feed_jobs`), JSON-LD Article, `head()` meta from seo_* fields.
- Navbar public "Learn" link + footer; view counting via server fn `trackContentView` (fire-and-forget, anon-allowed insert into content_events with user_id null).
**Acceptance:** published post renders with correct meta/JSON-LD; sitemap lists it; draft 404s; category page deep-links jobs.

### Phase 4 — Training modules player + progress (M)
- `/learn/courses`, `/learn/courses/$slug`: curriculum sidebar (locked vs free_preview vs enrolled), lesson player (YouTube embed / markdown / inline quiz), mark-complete, resume-where-left-off, course completion when all lessons done → `completed_at` + confetti toast.
- Server fns: `enrollCourse` (free → insert enrollment; paid → redirect to Phase 5 purchase), `completeLesson`, `getCourseProgress`.
- Candidate surface: "Learn" entry in `CandidateShell` nav array + dashboard "Continue learning" card.
**Acceptance:** free course end-to-end enroll→complete; progress survives reload; paid course gates non-preview lessons behind purchase CTA.

### Phase 5 — Certification marketplace + payments + certificates (L, money-critical)
- `/learn/certifications` marketplace (filters: category, price free/paid, provider) + `/learn/certifications/$slug` (syllabus, sample question, price, buy button).
- Candidate Razorpay: `create_candidate_cert_order` RPC (DEFINER: price snapshot from cert row, insert candidate_orders, return order id) → checkout (global script already loaded) → webhook verify (extend existing route: candidate order branch) → mark paid + insert `cert_purchases` idempotently. Free certs: direct `cert_purchases` insert via server fn.
- Assessment: timed attempt UI from `questions jsonb` (shuffled client-side, graded **server-side** in `submitCertAttempt` RPC — never trust client score), attempts ≤ max_attempts, results screen.
- On pass: `certificates` row + PDF (invoice-pdf pattern) to `content-media` + profile badge chip on candidate profile/public profile + "Add to applications" hint.
- Public `/verify/certificate/$certNo` page (holder name, cert title, issued date, validity).
**Acceptance:** paid purchase happy path (order→webhook→entitlement) and double-webhook idempotency; fail-then-retry respects max_attempts; certificate verifies publicly; failed payment leaves no entitlement.

### Phase 6 — Recommendation engine + career content feed (M)
- RPC `recommend_content(_user_id, _limit)` per design decision 7 (weights from `content_settings`); server fn wrapper + 5-min client cache.
- `/learn` authenticated home becomes the **Career Content Feed**: mixed cards with reason chips ("Fills your 'CRM' skill gap for Sales"), dismiss/seen handling via content_events, "Why am I seeing this?" popover.
- Cross-links: job detail page "Skills employers want — learn them" strip (tags ∩ job skills); course/cert pages "Jobs this helps with".
- Admin: content performance table (views/enrolls/completions/purchases per item, from content_events).
**Acceptance:** candidate with Sales roles + no CRM skill sees CRM-tagged course above generic posts; cold-start user gets popularity feed; weights editable in admin take effect without deploy.

## 6. Out of scope (v1)
- Video hosting/transcoding (YouTube/embed only); multi-author roles & editorial workflow; employer-sponsored seats/cohorts; GST invoices for individual purchases; native mobile app surfaces; comments/ratings; AI-generated content authoring; course bundles/paths; certificate revocation UI (manual SQL).

## 7. Risks & mitigations
- **Stored XSS via markdown/HTML body** → sanitize allowlist at render; no raw HTML; server fn strips `<script>` defensively.
- **Client-side quiz grading cheat** → grade in DEFINER RPC; questions served per-attempt without correct indices (strip in RPC).
- **Payment races / double entitlement** → UNIQUE(user,cert) + idempotent webhook + order status transitions inside one RPC with row lock (`SELECT ... FOR UPDATE` on candidate_orders row).
- **Recommender cold start / sparse events** → deterministic fallback (popularity + category); weights tunable; no ML dependency.
- **SEO thin/duplicate content** → canonical URLs, category pages only for categories with ≥N published items, noindex drafts.
- **Scope creep into LMS** → lessons are static content + quizzes only; no live classes, assignments, or proctoring.
- **Lovable sync** → one commit per phase, main always working, migrations pushed by user (no DB creds in agent env), never rewrite pushed history.

## 8. Sizing
| Phase | Effort | Notes |
|---|---|---|
| 1 Schema/storage/settings | S | Migration + types |
| 2 Learning CMS | M | Admin studio, media upload |
| 3 Public hub + SEO | M | First SEO infra in repo |
| 4 Course player + progress | M | Candidate surfaces |
| 5 Cert marketplace + payments | L | Money-critical, candidate Razorpay |
| 6 Recommender + feed | M | SQL RPC + feed UI |
