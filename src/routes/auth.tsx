import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  Loader2,
  Lock,
  ShieldCheck,
  Smartphone,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { AuthShell } from "@/components/site/AuthShell";
import { OtpInput } from "@/components/wizard/Questionnaire";
import { supabase } from "@/integrations/supabase/client";
import { loginOrCreateWithMobile } from "@/lib/auth-mobile.functions";
import type { SignupUserType } from "@/lib/auth";

const searchSchema = z.object({
  tab: z.enum(["candidate", "employer"]).optional(),
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Log in · JobsKart" },
      {
        name: "description",
        content: "Log in to JobsKart with your mobile number and a one-time code.",
      },
    ],
  }),
  component: AuthPage,
});

const tabMeta = {
  candidate: {
    icon: UserRound,
    label: "Candidate",
    hint: "Looking for work",
  },
  employer: {
    icon: Building2,
    label: "Employer",
    hint: "Hiring talent",
  },
} as const;

function AuthPage() {
  const search = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const [tab, setTab] = useState<SignupUserType>(search.tab ?? "candidate");

  const onSuccess = async (isNew: boolean) => {
    if (search.redirect) {
      window.location.assign(search.redirect);
      return;
    }
    if (tab === "candidate") {
      navigate({ to: isNew ? "/onboarding/candidate" : "/candidate/dashboard" });
      return;
    }
    // Employer: route to onboarding if they have no company yet (or onboarding incomplete).
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (uid) {
        const { data: members } = await supabase
          .from("employer_members")
          .select("company_id, companies(onboarding_completed)")
          .eq("user_id", uid)
          .limit(1);
        const row = members?.[0] as { companies?: { onboarding_completed?: boolean } } | undefined;
        const done = row?.companies?.onboarding_completed === true;
        navigate({ to: done ? "/employer/dashboard" : "/onboarding/employer" });
        return;
      }
    } catch {
      /* fall through */
    }
    navigate({ to: "/onboarding/employer" });
  };

  return (
    <AuthShell side={tab}>
      <div className="mx-auto w-full max-w-md">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1 text-xs font-medium text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-success" />
          Secure mobile login · OTP verified
        </div>

        <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground">
          Log in or sign up
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your mobile number — we&apos;ll send a one-time code. New here? We&apos;ll set up your account automatically.
        </p>

        {/* Segmented role switcher */}
        <div
          role="tablist"
          aria-label="Account type"
          className="mt-7 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-surface/60 p-1.5"
        >
          {(["candidate", "employer"] as const).map((t) => {
            const Meta = tabMeta[t];
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t)}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all ${
                  active
                    ? "bg-card shadow-sm ring-1 ring-primary/20"
                    : "hover:bg-card/60"
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground group-hover:text-foreground"
                  }`}
                >
                  <Meta.icon className="h-4 w-4" strokeWidth={2.25} />
                </span>
                <span className="flex flex-col leading-tight">
                  <span
                    className={`text-sm font-semibold ${
                      active ? "text-foreground" : "text-foreground/80"
                    }`}
                  >
                    {Meta.label}
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {Meta.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <MobileLoginForm key={tab} userType={tab} onSuccess={onSuccess} />

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3 w-3" /> 256-bit encryption
          </span>
          <span className="h-1 w-1 rounded-full bg-border" />
          <span>No password required</span>
          <span className="h-1 w-1 rounded-full bg-border" />
          <span>Trusted by 50L+ users</span>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree to JobsKart&apos;s Terms and Privacy Policy.
        </p>
      </div>
    </AuthShell>
  );
}

function MobileLoginForm({
  userType,
  onSuccess,
}: {
  userType: SignupUserType;
  onSuccess: (isNew: boolean) => Promise<void> | void;
}) {
  const [step, setStep] = useState<"mobile" | "otp">("mobile");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 400));
    setLoading(false);
    setStep("otp");
    toast.success(`OTP sent to +91 ${mobile} · demo: any 6 digits work`);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (otp.length !== 6) {
      setError("Enter the full 6-digit code.");
      return;
    }
    setLoading(true);
    try {
      const res = await loginOrCreateWithMobile({ data: { mobile, otp, userType } });
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        token_hash: res.tokenHash,
        type: "magiclink",
      });
      if (verifyErr) throw verifyErr;
      toast.success(res.isNew ? "Welcome to JobsKart!" : "Welcome back!");
      await onSuccess(res.isNew);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not log in.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const RoleIcon = userType === "employer" ? Briefcase : UserRound;

  if (step === "mobile") {
    return (
      <form onSubmit={handleSendOtp} className="mt-7 space-y-5">
        <div>
          <label
            htmlFor="login-mobile"
            className="flex items-center justify-between text-sm font-semibold text-foreground"
          >
            <span className="inline-flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-primary" />
              Mobile number
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <RoleIcon className="h-3 w-3" />
              {userType}
            </span>
          </label>

          <div
            className={`mt-2 flex items-stretch overflow-hidden rounded-xl border bg-card shadow-sm transition-all ${
              error
                ? "border-destructive ring-2 ring-destructive/15"
                : "border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
            }`}
          >
            <span className="flex items-center gap-1.5 border-r border-border bg-surface/70 px-3.5 text-sm font-semibold text-foreground">
              <span className="text-base leading-none">🇮🇳</span>
              +91
            </span>
            <input
              id="login-mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
              placeholder="98XXXXXXXX"
              className="h-14 flex-1 bg-transparent px-4 text-lg font-semibold tracking-wide text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            We&apos;ll text you a 6-digit code. Standard SMS rates may apply.
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || mobile.length !== 10}
          className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary-dark hover:shadow-md disabled:opacity-50 disabled:hover:shadow-sm"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              Send OTP
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleVerify} className="mt-7 space-y-5">
      <button
        type="button"
        onClick={() => {
          setStep("mobile");
          setOtp("");
          setError(null);
        }}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Change number
      </button>

      <div>
        <label className="block text-sm font-semibold text-foreground">
          Enter the 6-digit code
        </label>
        <p className="mt-1 text-sm text-muted-foreground">
          Sent to <span className="font-semibold text-foreground">+91 {mobile}</span>
        </p>
      </div>

      <OtpInput value={otp} onChange={setOtp} />

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || otp.length !== 6}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary-dark hover:shadow-md disabled:opacity-50 disabled:hover:shadow-sm"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <ShieldCheck className="h-4 w-4" />
            Verify &amp; log in
          </>
        )}
      </button>

      <p className="text-center text-xs text-muted-foreground">
        Demo mode — any 6 digits work for now.
      </p>
    </form>
  );
}
