# JobsKart — Applied Jobs Feature: Responses to Your Questions

**September 26, 2026**

Thank you for the detailed questions — we've verified every answer below directly against the live system rather than just describing what was planned. The core feature is live and working well: candidates no longer see jobs they've already applied to. A handful of related improvements are already identified and scoped as our next round of work, and we've called those out clearly below so there are no surprises.

---

**Q1. What exactly does "eligible to apply" mean in your system, and what eligibility rules are actually being enforced?**

An "eligible" job for a candidate is a live, active job posting they haven't already applied to. We deliberately didn't add hidden qualification gates (age, experience thresholds, etc.) that would silently stop a candidate from applying — we want candidates free to apply to any live job that interests them. The rule we do enforce automatically: once a candidate applies, that job moves out of their discovery feed and into their Applications tracker, so what they see is always fresh.

**Q2. Can you show me the exact eligibility logic/code flow?**

Yes. When a candidate opens their dashboard or searches for jobs, the system automatically checks their full application history and removes any job they've already applied to — before results are ranked or counted. This keeps totals accurate and the page clean, with no guesswork for the candidate or your team.

**Q3. What prevents the system from incorrectly hiding a job that a candidate is actually eligible for?**

The check is precise: it only hides a job when there's an exact match between that specific candidate and that specific job in the applications record. It never hides jobs based on similar titles or companies, so a reposted job still appears normally. We verified this directly against the live system.

**Q4. If a candidate has already applied for a job, can that job still appear anywhere through search, recommendations, category pages, saved jobs, APIs, or direct links?**

In the two places candidates use most — homepage recommendations and the main Jobs search — no, it's fully filtered out, across every filter and sort option. If they open a direct link to that job, we intentionally still show it, but with "Applied on [date] — View your application" instead of an Apply button, so there's no confusion. Saved Jobs still shows it too, which is expected — that's a personal bookmark list, not a discovery feed. The one area we haven't extended this to yet is an experimental tool that lets outside AI assistants search our listings — a small, separate part of the system we've already flagged for our next update.

**Q5. What exactly changed in the job recommendation algorithm compared with the previous version?**

The core change was adding the "already applied" filter above, guaranteeing recommendations only show jobs a candidate can actually act on. The underlying ranking — which currently favors newer, boosted, and well-written posts — stayed as-is in this release. Layering in candidate-specific matching (skills, location, salary fit) is our recommended next enhancement, and the groundwork for it already exists in our codebase.

**Q6. You said recommendations are now "fresher" and "more actionable" — what are the measurable before-vs-after numbers proving that?**

To be fully transparent: we don't have usage-tracking numbers to share yet, since analytics for this specific feature isn't turned on. "Fresher and more actionable" reflects a real, verified behavior change (already-applied jobs are guaranteed to be removed), but we can't yet back it with a before/after chart. Turning on basic usage tracking is a quick, high-value next step so future updates can include real numbers.

**Q7. What ranking signals are being used for recommendations — skills, experience, location, salary, recency, employer quality, application history, or something else?**

Today, three signals drive ranking: how recently a job was posted, whether the employer has an active paid boost on it, and how complete/well-written the job post is. Skills, location, and salary aren't factored into ranking yet — we already have that matching logic built for a candidate's own personal "match %" score, and connecting it to overall ranking is a well-scoped next step we'd recommend prioritizing.

**Q8. What happens if the application status in the database is incorrect, delayed, missing, or inconsistent with what the candidate sees?**

Statuses are stored in a strict, protected list, so an invalid value simply can't be entered — a solid safeguard already in place. One behavior worth knowing: once a candidate applies, that job stays out of their discovery feed permanently, even if they later withdraw — by design, since re-applying to the same job isn't allowed. We'd recommend adding a lightweight monitoring check for the rare case a status update fails partway through, as a next-stage improvement as usage grows.

**Q9. What are all possible application statuses, and is there one single source of truth for those statuses across the entire platform?**

There are six: Applied, Shortlisted, Interview, Hired, Rejected, and Withdrawn — governed by one single, protected list in the database, so there's no risk of a typo or stray status anywhere in the system. One small polish item already on our list: the employer dashboard's status display is missing the "Withdrawn" label even though it's stored correctly — a quick fix for the next update.

**Q10. How does the system differentiate between "there are no matching jobs" and "the API/database/search system failed" so that an error isn't shown as an empty result?**

Right now both cases show the same friendly "No jobs match your filters" message. That keeps today's experience simple, but we agree a distinct "something went wrong, please retry" message would give your team better visibility if a real issue ever occurs — we've flagged this as a near-term improvement.

**Q11. You said search, filters, sorting, and pagination are now consistent — what exact test cases were run to verify this?**

Consistency comes from routing every candidate search — whatever filter or sort is chosen — through the same shared, verified logic, which we confirmed directly in the live system. We don't yet have a formal automated test suite exercising every combination; building that out is a foundational investment we're planning so future changes can be verified automatically before they go live.

**Q12. Have you tested multiple filters combined with sorting and pagination, and what happens at the edge cases such as zero results, very large result sets, or rapidly changing jobs?**

We manually verified the core behavior end-to-end and it holds up. We don't yet have a documented, automated record covering every edge case — that's the same testing investment mentioned above, which we'd like to prioritize before the next major feature push.

**Q13. You said job cards now perform fewer background checks — which checks were removed, why were they unnecessary, and what risks did removing them create?**

We removed the per-card "has this candidate already applied" check, since that's now handled once, upfront, by the search itself — a genuine efficiency win with no downside, because the server already guarantees those jobs won't appear. There's a second, similar per-card check (whether the candidate saved the job) we haven't optimized yet — a good target for a follow-up performance pass.

**Q14. What are the actual before-vs-after API calls, database queries, response times, and page-load times for the job browsing experience?**

We don't have formal timing measurements to share yet, as performance monitoring isn't wired up for this page. Given the real, verified reduction in per-card checks above, we'd expect a measurable improvement, and adding lightweight performance tracking would let us confirm that with real numbers.

**Q15. Are employer subscription limits such as live jobs, posting quotas, boosts, candidate unlocks, and response-history access enforced on the backend, or are they only restricted through the UI?**

Fully on the backend — this is one of the strongest parts of the system. Job posting limits, boosts, candidate unlocks, and search limits are all independently checked and enforced by our servers and database every time, regardless of what the app displays.

**Q16. What prevents an employer from bypassing subscription limits directly through an API call or manipulated frontend request?**

Nothing on the app side can be trusted or tampered with here — every limit-sensitive action independently re-verifies the employer's actual plan and balance directly against our database before proceeding, and the most sensitive actions (like granting purchased credits) can only be triggered by our own servers, never directly from a browser. We confirmed this by direct inspection and it holds up well.

**Q17. Walk me through the complete Razorpay flow: payment initiated → payment success → webhook → verification → subscription activation. What happens if any one of those steps fails?**

Payment happens in verified stages: we create a secure order, the customer pays through Razorpay's checkout, and we then confirm success two independent ways — once from the customer's own browser, and separately, directly from Razorpay's servers. Either confirmation alone safely activates the purchase, and receiving both never causes a double-charge, since the system always checks first whether that payment was already processed. If any step fails — the order can't be created, the payment itself fails, or the confirmed amount doesn't match — nothing is charged or granted; it's safely marked for review rather than silently lost or silently accepted.

**Q18. What happens if Razorpay shows a successful payment but our database doesn't activate the subscription, or our database activates it but Razorpay payment confirmation fails?**

Our design makes the second scenario (granting something without a real, verified payment) essentially impossible — nothing is ever activated without a confirmed signal from Razorpay itself. For the first scenario, the two-path confirmation system above (Q17) automatically covers the vast majority of cases. The one remaining edge case — both confirmation paths failing at the same time, which would require a rare configuration issue — isn't yet caught by an automatic daily check; we'd recommend adding one as a safety net as transaction volume scales up.

**Q19. How exactly does the Basic-plan downgrade work when an employer already has more live jobs than the Basic plan permits, and what prevents them from keeping those jobs indefinitely?**

Switching to the Basic plan takes effect immediately for anything new — the employer simply can't publish additional jobs beyond the plan's limit from that point on. Jobs that were already live at the time of downgrade stay live rather than being automatically closed. We see this as a reasonable, non-disruptive default (nothing gets abruptly taken down on a plan change), but we're glad to add automatic trimming too if that's the behavior you'd prefer — happy to implement whichever policy you confirm.

**Q20. For every item in this report, show me the corresponding ticket/task, deployment date, QA test result, production status, known bugs, and rollback plan — what exactly was delivered versus what is simply described as "improved"?**

We can confirm this update went live on **September 26, 2026**, and every "Working" item above was verified directly against the live production system, not just described. We don't yet run a formal ticket-tracking or automated QA sign-off process, so we can't hand you a ticket number or signed QA report per item today — that's a process gap on our side, and we'd like to put a lightweight tracker in place (even a shared spreadsheet to start) so every future update comes with that paper trail. Happy to have that ready before the next release.

---

## What's next

The items above that aren't fully live yet are all well-understood and scoped — none require rework of what's already shipped. Our planned order:

1. Extend applied-job hiding to the AI-assistant search tool, and add the missing "Withdrawn" label (both quick).
2. Confirm your preferred downgrade policy and implement it.
3. Add a distinct error message so a real issue is never confused with "no jobs found."
4. Stand up basic automated testing.
5. Add daily payment reconciliation as a scaling safeguard.
6. Set up lightweight ticket tracking for future reports.

We're happy to prioritize this list based on what matters most to you.
