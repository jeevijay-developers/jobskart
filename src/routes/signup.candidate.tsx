import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/site/AuthShell";
import { Field, GoogleIcon } from "@/components/site/AuthFields";
import { signInWithGoogle, signUpCandidate } from "@/lib/auth";

export const Route = createFileRoute("/signup/candidate")({
  head: () => ({
    meta: [
      { title: "Create your candidate account · JobsKart" },
      { name: "description", content: "Sign up as a job seeker on JobsKart in under 2 minutes." },
    ],
  }),
  component: CandidateSignupPage,
});

const INDIAN_CITIES = [
  "Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Ahmedabad", "Chennai", "Kolkata",
  "Surat", "Pune", "Jaipur", "Lucknow", "Kanpur", "Nagpur", "Indore", "Bhopal",
  "Patna", "Vadodara", "Ghaziabad", "Ludhiana", "Agra", "Nashik", "Faridabad",
  "Meerut", "Rajkot", "Varanasi", "Srinagar", "Aurangabad", "Dhanbad", "Amritsar",
  "Navi Mumbai", "Allahabad", "Ranchi", "Coimbatore", "Vijayawada", "Jodhpur",
  "Madurai", "Raipur", "Kota", "Guwahati", "Chandigarh", "Thiruvananthapuram",
];

const SUGGESTED_SKILLS = [
  "Driving", "Customer Service", "Sales", "Cash Handling", "MS Office",
  "Tally", "Hindi", "English", "Telecalling", "Computer Basics", "Inventory",
  "Housekeeping", "Cooking", "Welding", "Electrician", "Plumbing",
];

const JOB_TYPES = ["Full Time", "Part Time", "Work from Home", "Contract"];

type Step = 1 | 2 | 3;

function CandidateSignupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Step 1
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [city, setCity] = useState("");
  // Step 2
  const [expStatus, setExpStatus] = useState<"fresher" | "experienced" | "student">("fresher");
  const [years, setYears] = useState("0");
  const [lastRole, setLastRole] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  // Step 3
  const [bio, setBio] = useState("");

  const strength = useMemo(() => {
    let s = 20;
    if (fullName && mobile && email && password && city) s += 25;
    if (expStatus) s += 10;
    if (skills.length >= 3) s += 20;
    if (jobTypes.length) s += 10;
    if (bio.length > 30) s += 15;
    return Math.min(s, 100);
  }, [fullName, mobile, email, password, city, expStatus, skills, jobTypes, bio]);

  const validateStep1 = () => {
    if (!fullName.trim()) return "Please enter your full name.";
    if (!/^[6-9]\d{9}$/.test(mobile)) return "Enter a valid 10-digit Indian mobile number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (password !== confirm) return "Passwords do not match.";
    if (!city) return "Please pick your city.";
    return null;
  };

  const next = () => {
    if (step === 1) {
      const err = validateStep1();
      if (err) return toast.error(err);
    }
    if (step === 2) {
      if (expStatus === "experienced" && (!years || Number(years) < 1)) {
        return toast.error("Please enter your years of experience.");
      }
    }
    setStep((s) => (s < 3 ? ((s + 1) as Step) : s));
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      const res = await signInWithGoogle("candidate");
      if (!res.redirected) {
        toast.success("Account created with Google!");
        navigate({ to: "/candidate/dashboard" });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await signUpCandidate({
        fullName: fullName.trim(),
        email: email.trim(),
        mobile: `+91${mobile}`,
        password,
        city,
      });
      toast.success("Account created! Redirecting…");
      navigate({ to: "/candidate/dashboard" });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Signup failed.");
    } finally {
      setLoading(false);
    }
  };

  const addSkill = (s: string) => {
    const t = s.trim();
    if (!t || skills.includes(t) || skills.length >= 10) return;
    setSkills([...skills, t]);
    setSkillInput("");
  };

  return (
    <AuthShell side="candidate">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Create your candidate account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Step {step} of 3 · Profile strength {strength}%
        </p>

        {/* progress bar */}
        <div className="mt-4 flex items-center gap-2">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                n <= step ? "bg-primary" : "bg-border"
              }`}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="mt-6 space-y-4">
            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleLoading}
              className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-border bg-card text-sm font-semibold text-foreground transition-colors hover:bg-surface disabled:opacity-60"
            >
              {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
              Sign up with Google
            </button>
            <div className="relative py-2 text-center text-xs text-muted-foreground">
              <span className="absolute left-0 top-1/2 h-px w-[42%] bg-border" />
              <span className="bg-background px-2">OR USE EMAIL</span>
              <span className="absolute right-0 top-1/2 h-px w-[42%] bg-border" />
            </div>

            <Field label="Full Name" required>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="form-input"
                placeholder="Rahul Sharma"
              />
            </Field>
            <Field label="Mobile Number" required hint="10-digit Indian number">
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-border bg-surface px-3 text-sm text-muted-foreground">
                  +91
                </span>
                <input
                  inputMode="numeric"
                  maxLength={10}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
                  className="form-input rounded-l-none"
                  placeholder="98XXXXXXXX"
                />
              </div>
            </Field>
            <Field label="Email" required>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
                placeholder="you@example.com"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Password" required>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="form-input pr-10"
                    placeholder="Min 8 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label="Toggle password visibility"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Confirm" required>
                <input
                  type={showPw ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="form-input"
                  placeholder="Re-enter password"
                />
              </Field>
            </div>
            <Field label="City / Location" required>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="form-input"
              >
                <option value="">Select your city…</option>
                {INDIAN_CITIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="mt-6 space-y-5">
            <Field label="Current Job Status" required>
              <div className="grid grid-cols-3 gap-2">
                {(["fresher", "experienced", "student"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setExpStatus(opt)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                      expStatus === opt
                        ? "border-primary bg-primary-light text-primary"
                        : "border-border bg-card text-foreground hover:bg-surface"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </Field>

            {expStatus === "experienced" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Years of Experience" required>
                  <select
                    value={years}
                    onChange={(e) => setYears(e.target.value)}
                    className="form-input"
                  >
                    {Array.from({ length: 21 }).map((_, i) => (
                      <option key={i} value={i}>{i === 20 ? "20+" : i} years</option>
                    ))}
                  </select>
                </Field>
                <Field label="Last/Current Role">
                  <input
                    value={lastRole}
                    onChange={(e) => setLastRole(e.target.value)}
                    className="form-input"
                    placeholder="e.g. Delivery Executive"
                  />
                </Field>
              </div>
            )}

            <Field label="Skills" hint={`${skills.length}/10 selected`}>
              <div className="flex flex-wrap gap-2">
                {skills.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-medium"
                  >
                    {s}
                    <button
                      type="button"
                      onClick={() => setSkills(skills.filter((x) => x !== s))}
                      aria-label={`Remove ${s}`}
                      className="ml-0.5 text-primary-foreground/80 hover:text-primary-foreground"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSkill(skillInput);
                  }
                }}
                placeholder="Type a skill and press Enter"
                className="form-input mt-2"
              />
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Suggested
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SUGGESTED_SKILLS.filter((s) => !skills.includes(s)).slice(0, 10).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => addSkill(s)}
                      className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground hover:border-primary hover:bg-primary-light hover:text-primary"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              </div>
            </Field>

            <Field label="Preferred Job Types">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {JOB_TYPES.map((t) => {
                  const on = jobTypes.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        setJobTypes(on ? jobTypes.filter((x) => x !== t) : [...jobTypes, t])
                      }
                      className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                        on
                          ? "border-primary bg-primary-light text-primary"
                          : "border-border bg-card text-foreground hover:bg-surface"
                      }`}
                    >
                      {on && <Check className="mr-1 inline h-3 w-3" />}
                      {t}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="mt-6 space-y-5">
            <Field label="Short bio (optional)" hint="Tell employers about yourself in 1–2 lines">
              <textarea
                rows={5}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="form-input resize-none"
                placeholder="e.g. Experienced delivery executive with 3+ years in Mumbai. Own bike, knows local routes well."
              />
            </Field>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-sm font-semibold text-foreground">
                You can add a profile photo and documents after sign up.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Complete profiles get up to 3x more employer responses.
              </p>
            </div>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
            disabled={step === 1}
            className="inline-flex h-11 items-center gap-1 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-surface disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={next}
              className="inline-flex h-11 items-center gap-1 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-dark"
            >
              Next <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-dark disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Complete Profile
            </button>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/auth" search={{ tab: "candidate" }} className="font-semibold text-primary hover:text-primary-dark">
            Log in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
