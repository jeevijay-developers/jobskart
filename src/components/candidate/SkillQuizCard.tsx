import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, ListChecks, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Attempt = { passed: boolean; created_at: string };

/**
 * Optional, candidate-initiated "Verify your skills" card for the profile
 * page — never blocks any other flow. Resolves the quiz category from the
 * candidate's own role_category() (last_role, falling back to their first
 * interested role) so the quiz always matches what they're job-hunting for,
 * same taxonomy the job feed and recruiter match score already use.
 */
export function SkillQuizCard({
  lastRole,
  interestedRoles,
}: {
  lastRole: string | null;
  interestedRoles: string[] | null;
}) {
  const [category, setCategory] = useState<string | null | undefined>(undefined);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [cooldownDays, setCooldownDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const title = lastRole || interestedRoles?.[0] || null;
      if (!title) {
        if (!cancelled) {
          setCategory(null);
          setLoading(false);
        }
        return;
      }
      const [{ data: cat }, { data: settings }] = await Promise.all([
        supabase.rpc("role_category" as never, { _role: title } as never),
        supabase.from("plan_settings").select("skill_quiz_cooldown_days").eq("id", 1).maybeSingle(),
      ]);
      if (cancelled) return;
      const resolved = (cat as unknown as string | null) ?? null;
      setCategory(resolved);
      setCooldownDays((settings as { skill_quiz_cooldown_days?: number } | null)?.skill_quiz_cooldown_days ?? 30);
      if (resolved) {
        const { data: u } = await supabase.auth.getUser();
        if (u.user) {
          const { data: last } = await supabase
            .from("candidate_quiz_attempts")
            .select("passed, created_at")
            .eq("user_id", u.user.id)
            .eq("category", resolved)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!cancelled) setAttempt((last as Attempt | null) ?? null);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [lastRole, interestedRoles]);

  if (loading) return <div className="h-24 animate-pulse rounded-2xl bg-card" />;
  // No role on file yet — nothing to quiz on. The Skills/Career cards already
  // nudge the candidate to add one; this card just stays hidden until then.
  if (!category) return null;

  const retryAt = attempt ? new Date(attempt.created_at) : null;
  if (retryAt) retryAt.setDate(retryAt.getDate() + cooldownDays);
  const onCooldown = retryAt ? retryAt > new Date() : false;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
          {attempt?.passed ? <ShieldCheck className="h-5 w-5" /> : <ListChecks className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-foreground">{category} skill quiz</h3>
          <p className="text-xs text-muted-foreground">
            {attempt?.passed
              ? "Verified — recruiters hiring for this role now see a Skill Verified badge on your profile."
              : attempt && onCooldown
                ? `Not verified yet. You can retake it after ${retryAt!.toLocaleDateString()}.`
                : attempt
                  ? "Not verified yet — you can retake the quiz now."
                  : "A free, 5-minute quiz to show recruiters you're ready for this role."}
          </p>
        </div>
        {attempt?.passed ? (
          <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-success" />
        ) : !onCooldown ? (
          <Link
            to="/candidate/quiz/$category"
            params={{ category }}
            className="ml-auto shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary-dark"
          >
            {attempt ? "Retake" : "Take quiz"}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
