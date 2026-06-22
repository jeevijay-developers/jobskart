import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import {
  BigInput,
  ChipChoice,
  OtpInput,
  Questionnaire,
  type WizardStep,
} from "@/components/wizard/Questionnaire";
import { signUpEmployer } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/signup/employer")({
  head: () => ({
    meta: [
      { title: "Register your company · JobsKart for Employers" },
      {
        name: "description",
        content:
          "Post jobs and hire blue-collar talent across India. Sign up in under 2 minutes — one question at a time.",
      },
    ],
  }),
  component: EmployerSignupPage,
});

type Size = "1-10" | "11-50" | "51-200" | "201-500" | "500+";

const CITIES = [
  "Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Kolkata",
  "Pune", "Ahmedabad", "Jaipur", "Lucknow", "Indore", "Chandigarh",
];

function EmployerSignupPage() {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [size, setSize] = useState<Size>("11-50");
  const [city, setCity] = useState("Mumbai");

  const steps: WizardStep[] = [
    {
      key: "mobile",
      title: "Your work mobile number",
      hint: "We'll send a 6-digit verification code.",
      validate: () =>
        /^[6-9]\d{9}$/.test(mobile) ? null : "Enter a valid 10-digit mobile number.",
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
              className="ml-2 font-semibold text-primary hover:underline"
            >
              Change
            </button>
          </p>
        </div>
      ),
    },
    {
      key: "name",
      title: "What's your name?",
      hint: "We'll use this on your employer profile.",
      validate: () => (name.trim().length >= 2 ? null : "Please enter your name."),
      render: () => (
        <BigInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Priya Verma"
          autoCapitalize="words"
        />
      ),
    },
    {
      key: "email",
      title: "Your work email",
      hint: "Use your company domain when possible for faster verification.",
      validate: () =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : "Enter a valid email.",
      render: () => (
        <BigInput
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="priya@company.com"
        />
      ),
    },
    {
      key: "password",
      title: "Set a password",
      hint: "Minimum 8 characters.",
      validate: () =>
        password.length >= 8 ? null : "Password must be at least 8 characters.",
      render: () => (
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
      ),
    },
    {
      key: "company",
      title: "Your company name",
      hint: "You can update full details later.",
      validate: () =>
        companyName.trim().length >= 2 ? null : "Please enter your company name.",
      render: () => (
        <BigInput
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="BrightMart Retail Pvt Ltd"
        />
      ),
    },
    {
      key: "size",
      title: "How big is your team?",
      validate: () => null,
      render: () => (
        <ChipChoice
          value={size}
          onChange={(v) => setSize(v as Size)}
          options={[
            { value: "1-10", label: "1 – 10", hint: "Small / startup" },
            { value: "11-50", label: "11 – 50", hint: "Growing team" },
            { value: "51-200", label: "51 – 200", hint: "Mid-sized" },
            { value: "201-500", label: "201 – 500", hint: "Large company" },
            { value: "500+", label: "500+", hint: "Enterprise" },
          ]}
        />
      ),
    },
    {
      key: "city",
      title: "Primary hiring city?",
      hint: "You can add more later.",
      validate: () => null,
      render: () => (
        <ChipChoice
          value={city}
          onChange={(v) => setCity(v as string)}
          options={CITIES.map((c) => ({ value: c, label: c }))}
        />
      ),
    },
  ];

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const { user } = await signUpEmployer({
        fullName: name.trim(),
        email: email.trim(),
        mobile: `+91${mobile}`,
        password,
        company: {
          name: companyName.trim(),
          companyType: "pvt_ltd",
          industry: "Other",
          size,
          primaryCity: city,
          pincode: "400001",
        },
      });
      if (user) {
        await supabase
          .from("profiles")
          .update({ mobile_verified: true })
          .eq("id", user.id);
      }
      toast.success("Welcome aboard! Opening your dashboard…");
      navigate({ to: "/employer/dashboard" });
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
      submitLabel="Create employer account"
      side="employer"
      loginHref={{ to: "/auth", search: { tab: "employer" } }}
      brandKicker="For employers"
    />
  );
}
