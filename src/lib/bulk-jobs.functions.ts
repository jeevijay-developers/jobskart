import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { mapTierError } from "@/lib/jobs.functions";
import { JOB_CATEGORIES } from "@/lib/options";
import { validateBulkRow, type BulkJobRow } from "@/lib/jd-bulk-template";

const RowSchema = z.object({
  title: z.string().min(2),
  city: z.string().optional().default(""),
  job_type: z.string().default("full_time"),
  work_mode: z.string().default("on_site"),
  min_salary: z.number().nullable().optional(),
  max_salary: z.number().nullable().optional(),
  min_experience_years: z.number().nullable().optional(),
  max_experience_years: z.number().nullable().optional(),
  education: z.string().optional().default(""),
  skills: z.string().optional().default(""),
  description: z.string().optional().default(""),
  openings: z.number().int().positive().default(1),
  category: z.string().optional().default(""),
  pincode: z.string().optional().default(""),
  industry: z.string().optional().default(""),
  pay_type: z.string().optional().default(""),
  working_weekdays: z.string().optional().default(""),
  hiring_contact_mode: z.string().optional().default(""),
  hiring_contact_name: z.string().optional().default(""),
  hiring_contact_phone: z.string().optional().default(""),
  hiring_contact_email: z.string().optional().default(""),
  interview_type: z.string().optional().default(""),
  interview_city: z.string().optional().default(""),
  interview_address: z.string().optional().default(""),
  certifications: z.string().optional().default(""),
  certifications_not_required: z.boolean().optional().default(false),
});

const Input = z.object({
  company_id: z.string().uuid(),
  rows: z.array(RowSchema).min(1).max(200),
});

// Read-only: lets the bulk page show "X will go live / Y skipped — plan
// limit reached" in the preview before the employer clicks Publish, using
// the exact same get_company_entitlements() figures bulkCreateJobs itself
// will use. Never mutates anything.
export const getBulkPostAllowance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ company_id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: entitlements, error } = await context.supabase.rpc("get_company_entitlements", {
      _company_id: data.company_id,
    });
    if (error) throw new Error(error.message);
    const ent = entitlements as unknown as {
      limits: { live_jobs_max: number };
      usage: { live_jobs: number };
    };
    const liveJobsMax = ent.limits.live_jobs_max;
    // null = unlimited (JSON-serializable, unlike Infinity).
    const remaining =
      liveJobsMax === -1 ? null : Math.max(0, liveJobsMax - ent.usage.live_jobs);
    return { liveJobsMax, liveJobsCurrent: ent.usage.live_jobs, remaining };
  });

export const bulkCreateJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: member } = await supabase
      .from("employer_members")
      .select("role")
      .eq("company_id", data.company_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!member) throw new Error("Not a member of this company");

    // Same publish-time rules JobWizard enforces, re-run here so a request
    // that bypasses the browser preview (or a stale client) still can't
    // publish an incomplete job. Rows that fail are skipped entirely —
    // never inserted even as a draft — so this never returns a partially
    // wrong row to clean up.
    const validRows = data.rows.filter((r) => !validateBulkRow(r as BulkJobRow));
    if (!validRows.length) throw new Error("No valid rows to publish — fix the errors shown and re-upload.");

    // Pre-flight cap check: the same live_jobs_max/live_jobs usage
    // activate_job_with_tier() itself checks per job (get_company_entitlements(),
    // read here with the caller's own session, same as getCompanyEntitlements()
    // in jobs.functions.ts), computed once up front so bulk never inserts more
    // draft rows than the plan can actually activate. -1 means unlimited.
    const { data: entitlements, error: entErr } = await supabase.rpc("get_company_entitlements", {
      _company_id: data.company_id,
    });
    if (entErr) throw new Error(entErr.message);
    const ent = entitlements as unknown as {
      limits: { live_jobs_max: number };
      usage: { live_jobs: number };
    };
    const liveJobsMax = ent.limits.live_jobs_max;
    const allowed =
      liveJobsMax === -1 ? validRows.length : Math.max(0, liveJobsMax - ent.usage.live_jobs);

    // Sheet order preserved: validRows is already filter()'d (stable order),
    // so the first `allowed` rows are exactly "first N valid rows in the
    // sheet" per the task's spec. Rows beyond that are never inserted.
    const rowsToPublish = validRows.slice(0, allowed);
    const rowsSkippedForLimit = validRows.length - rowsToPublish.length;

    if (!rowsToPublish.length) {
      return {
        count: 0,
        drafts: 0,
        failure: null,
        skippedInvalid: data.rows.length - validRows.length,
        skippedLimit: rowsSkippedForLimit,
        liveJobsMax,
        liveJobsCurrent: ent.usage.live_jobs,
      };
    }

    const validJobTypes = new Set(["full_time","part_time","contract","internship","temporary"]);
    const validModes = new Set(["onsite","remote","hybrid","field"]);
    const payload = rowsToPublish.map((r) => ({
      company_id: data.company_id,
      posted_by: userId,
      title: r.title,
      city: r.city || null,
      job_type: validJobTypes.has(r.job_type) ? r.job_type : "full_time",
      work_mode: validModes.has(r.work_mode) ? r.work_mode : "onsite",
      min_salary: r.min_salary ?? null,
      max_salary: r.max_salary ?? null,
      min_experience_years: r.min_experience_years ?? null,
      max_experience_years: r.max_experience_years ?? null,
      education: r.education || null,
      skills: r.skills ? r.skills.split(",").map((s) => s.trim()).filter(Boolean) : [],
      description: r.description || r.title,
      openings: r.openings,
      // A recognised category from the sheet, else NULL: the jobs_infer_category trigger then fills it from
      // the title (and leaves it NULL when the title cannot be classified, never a guessed "Other").
      category: JOB_CATEGORIES.find((c) => c.toLowerCase() === r.category.trim().toLowerCase()) ?? null,
      pincode: r.pincode || null,
      industry: r.industry || null,
      pay_type: r.pay_type,
      working_weekdays: r.working_weekdays
        ? r.working_weekdays.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
        : [],
      hiring_contact_mode: r.hiring_contact_mode || null,
      hiring_contact_name: r.hiring_contact_name,
      hiring_contact_phone: r.hiring_contact_phone,
      hiring_contact_email: r.hiring_contact_email,
      interview_type: r.interview_type,
      interview_city: r.interview_city || null,
      interview_address: r.interview_address || null,
      certifications: r.certifications
        ? r.certifications.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      certifications_not_required: r.certifications_not_required,
      // RLS only lets an INSERT create a draft; going live is activate_job_with_tier() below
      // (the same path single-job posting uses for entitlement checks + credit charging).
      status: "draft",
      salary_period: "monthly",
    }));

    const { data: inserted, error } = await supabase.from("jobs").insert(payload as never).select("id");
    if (error) throw new Error(error.message);

    // Activate sequentially: the RPC row-locks the job and takes a per-company
    // lock while it counts quota/credits, so each activation must see the
    // previous one's effect. activate_job_with_tier() remains the final
    // authority on the cap — the pre-flight check above only sizes the batch
    // so it doesn't normally need to reject anything, but a concurrent post
    // from another tab/recruiter can still shrink the real remaining quota
    // mid-loop. On a per-row failure (cap hit mid-batch, credits, a race),
    // that row stays as a draft and the loop continues to the next row
    // instead of stopping — nothing is deleted, every other row still gets
    // its own chance to activate.
    const ids = ((inserted ?? []) as { id: string }[]).map((j) => j.id);
    let count = 0;
    let firstFailure: string | null = null;
    for (const id of ids) {
      const { error: activateError } = await supabase.rpc("activate_job_with_tier", {
        _job_id: id,
        _tier: "classic",
      });
      if (activateError) {
        if (!firstFailure) firstFailure = mapTierError(activateError.message);
        continue;
      }
      count++;
    }
    return {
      count,
      drafts: ids.length - count,
      failure: firstFailure,
      skippedInvalid: data.rows.length - validRows.length,
      skippedLimit: rowsSkippedForLimit,
      liveJobsMax,
      liveJobsCurrent: ent.usage.live_jobs,
    };
  });
