import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import {
  BigInput,
  ChipChoice,
  OtpInput,
  Questionnaire,
  type WizardStep,
} from "@/components/wizard/Questionnaire";
import { signUpCandidate } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/signup/candidate")({
  head: () => ({
    meta: [
      { title: "Join JobsKart · Create your candidate account" },
      {
        name: "description",
        content:
          "Sign up in 60 seconds with your mobile number. One question at a time — no boring forms.",
      },
    ],
  }),
  component: CandidateSignupPage,
});

type Intent = "fresher" | "experienced" | "switching" | "exploring";

function CandidateSignupPage() {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [intent, setIntent] = useState<Intent>("fresher");

  const pwStrength = useMemo(() => {
    let s = 0;
    if (password.length >= 8) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/\d/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s; // 0..4
  }, [password]);

  const steps: WizardStep[] = [
    {
      key: "mobile",
      title: "What's your mobile number?",
      hint: "We'll send a one-time code to verify it.",
      validate: () =>
        /^[6-9]\d{9}$/.test(mobile) ? null : "Enter a valid 10-digit Indian mobile number.",
      render: () => (
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
      ),
    },
    {
      key: "otp",
      title: "Enter the 6-digit code",
      hint: "Demo mode — any 6 digits will work for now.",
      validate: () => (otp.length === 6 ? null : "Enter the full 6-digit code."),
      render: () => (
        <div>
          <OtpInput value={otp} onChange={setOtp} />
          <p className="mt-4 text-sm text-muted-foreground">
            Sent to <span className="font-semibold text-foreground">+91 {mobile}</span>{" "}
            <button
              type="button"
              onClick={() => setIndex(0)}
              className="ml-2 font-semibold text-emerald-600 hover:underline"
            >
              Change
            </button>
          </p>
        </div>
      ),
    },
    {
      key: "name",
      title: "Nice — what should we call you?",
      hint: "Use your full name as on your ID.",
      validate: () => (name.trim().length >= 2 ? null : "Please enter your name."),
      render: () => (
        <BigInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rahul Sharma"
          autoCapitalize="words"
        />
      ),
    },
    {
      key: "email",
      title: "Your email address?",
      hint: "We'll use this for job alerts and account recovery.",
      validate: () =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : "Enter a valid email.",
      render: () => (
        <BigInput
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />
      ),
    },
    {
      key: "password",
      title: "Set a password",
      hint: "Minimum 8 characters. Mix letters, numbers and a symbol for best strength.",
      validate: () =>
        password.length >= 8 ? null : "Password must be at least 8 characters.",
      render: () => (
        <div>
          <div className="relative">
            <BigInput
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-label="Toggle password"
            >
              {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          <div className="mt-4 flex gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full ${
                  i < pwStrength
                    ? pwStrength <= 1
                      ? "bg-destructive"
                      : pwStrength === 2
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    : "bg-border"
                }`}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {["Too weak", "Weak", "Fair", "Strong", "Excellent"][pwStrength]}
          </p>
        </div>
      ),
    },
    {
      key: "intent",
      title: "What brings you to JobsKart?",
      hint: "We'll tailor your dashboard to fit.",
      validate: () => null,
      render: () => (
        <ChipChoice
          value={intent}
          onChange={(v) => setIntent(v as Intent)}
          options={[
            { value: "fresher", label: "I'm a fresher", hint: "Looking for my first job" },
            { value: "experienced", label: "I have experience", hint: "1+ year of work" },
            { value: "switching", label: "I want to switch", hint: "Looking for a change" },
            { value: "exploring", label: "Just exploring", hint: "Browsing what's out there" },
          ]}
        />
      ),
    },
  ];

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const result = await signUpCandidate({
        fullName: name.trim(),
        email: email.trim(),
        mobile: `+91${mobile}`,
        password,
        city: "",
      });
      // Persist mobile_verified + signup_intent
      if (result.user) {
        await supabase
          .from("profiles")
          .update({ mobile_verified: true, signup_intent: intent })
          .eq("id", result.user.id);
      }
      toast.success("Welcome to JobsKart! Let's complete your profile.");
      navigate({ to: "/onboarding/candidate" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Signup failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Questionnaire
      steps={steps}
      index={index}
      onIndex={setIndex}
      onSubmit={handleSubmit}
      submitting={submitting}
      submitLabel="Create my account"
      side="candidate"
      loginHref={{ to: "/auth", search: { tab: "candidate" } }}
      brandKicker="For job seekers"
    />
  );
}
