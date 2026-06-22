import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
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
import { loginWithMobileOtp } from "@/lib/auth-mobile.functions";
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

function AuthPage() {
  const search = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const [tab, setTab] = useState<SignupUserType>(search.tab ?? "candidate");

  const onSuccess = async () => {
    if (search.redirect) {
      window.location.assign(search.redirect);
    } else {
      navigate({
        to: tab === "employer" ? "/employer/dashboard" : "/candidate/dashboard",
      });
    }
  };

  return (
    <AuthShell side={tab}>
      <div>
        <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Log in with your mobile number — we&apos;ll send you a one-time code.
        </p>

        {/* Tabs */}
        <div className="mt-6 inline-flex rounded-xl bg-surface p-1">
          {(["candidate", "employer"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                tab === t
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              I&apos;m a {t === "candidate" ? "Candidate" : "Employer"}
            </button>
          ))}
        </div>

        <MobileLoginForm key={tab} userType={tab} onSuccess={onSuccess} />

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New to JobsKart?{" "}
          <Link
            to={tab === "employer" ? "/signup/employer" : "/signup/candidate"}
            className="font-semibold text-primary hover:text-primary-dark"
          >
            Create {tab === "employer" ? "an employer account" : "a candidate account"}
          </Link>
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
  onSuccess: () => Promise<void> | void;
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
    // Stub: pretend to send an SMS.
    await new Promise((r) => setTimeout(r, 400));
    setLoading(false);
    setStep("otp");
    toast.success(`OTP sent to +91 ${mobile} (demo: any 6 digits work)`);
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
      const res = await loginWithMobileOtp({ data: { mobile, otp, userType } });
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        token_hash: res.tokenHash,
        type: "magiclink",
      });
      if (verifyErr) throw verifyErr;
      toast.success("Welcome back!");
      await onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not log in.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (step === "mobile") {
    return (
      <form onSubmit={handleSendOtp} className="mt-6 space-y-4">
        <label className="block text-sm font-semibold text-foreground">
          Mobile number
        </label>
        <div className="flex items-end gap-3">
          <span className="pb-3 text-2xl font-medium text-muted-foreground">+91</span>
          <BigInput
            inputMode="numeric"
            maxLength={10}
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
            placeholder="98XXXXXXXX"
          />
        </div>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Send OTP
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleVerify} className="mt-6 space-y-4">
      <div>
        <label className="block text-sm font-semibold text-foreground">
          Enter the 6-digit code
        </label>
        <p className="mt-1 text-sm text-muted-foreground">
          Sent to <span className="font-semibold text-foreground">+91 {mobile}</span>
          <button
            type="button"
            onClick={() => {
              setStep("mobile");
              setOtp("");
              setError(null);
            }}
            className="ml-2 font-semibold text-primary hover:underline"
          >
            Change
          </button>
        </p>
      </div>

      <OtpInput value={otp} onChange={setOtp} />

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-dark disabled:opacity-60"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Verify &amp; log in
      </button>

      <p className="text-center text-xs text-muted-foreground">
        Demo mode — any 6 digits work for now.
      </p>
    </form>
  );
}
