import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { AuthShell } from "@/components/site/AuthShell";
import { Field, GoogleIcon } from "@/components/site/AuthFields";
import {
  signInWithEmail,
  signInWithGoogle,
  type SignupUserType,
} from "@/lib/auth";

const searchSchema = z.object({
  tab: z.enum(["candidate", "employer"]).optional(),
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Log in · JobsKart" },
      { name: "description", content: "Log in to JobsKart as a candidate or employer." },
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
      navigate({ to: tab === "employer" ? "/employer/dashboard" : "/candidate/dashboard" });
    }
  };

  return (
    <AuthShell side={tab}>
      <div>
        <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Log in to continue to your JobsKart account.
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
              I'm a {t === "candidate" ? "Candidate" : "Employer"}
            </button>
          ))}
        </div>

        <LoginForm key={tab} userType={tab} onSuccess={onSuccess} />

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

function LoginForm({
  userType,
  onSuccess,
}: {
  userType: SignupUserType;
  onSuccess: () => Promise<void> | void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      await signInWithEmail(email.trim(), password);
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

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      const res = await signInWithGoogle(userType);
      if (!res.redirected) {
        toast.success("Signed in with Google!");
        await onSuccess();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <Field label="Email" required>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="form-input"
        />
      </Field>

      <Field label="Password" required>
        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="form-input pr-11"
          />
          <button
            type="button"
            aria-label={showPw ? "Hide password" : "Show password"}
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>

      <div className="flex items-center justify-between text-sm">
        <Link
          to="/forgot-password"
          className="font-medium text-primary hover:text-primary-dark"
        >
          Forgot password?
        </Link>
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
        Log in
      </button>

      <div className="relative py-2 text-center text-xs text-muted-foreground">
        <span className="absolute left-0 top-1/2 h-px w-[42%] bg-border" />
        <span className="bg-background px-2">OR</span>
        <span className="absolute right-0 top-1/2 h-px w-[42%] bg-border" />
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={googleLoading}
        className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-border bg-card text-sm font-semibold text-foreground transition-colors hover:bg-surface disabled:opacity-60"
      >
        {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
        Continue with Google
      </button>
    </form>
  );
}

