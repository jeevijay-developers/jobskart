import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff, Loader2, ShieldCheck, Sparkles, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/site/AuthShell";
import { Field, GoogleIcon } from "./auth";
import { signInWithGoogle, signUpEmployer } from "@/lib/auth";

export const Route = createFileRoute("/signup/employer")({
  head: () => ({
    meta: [
      { title: "Register your company · JobsKart for Employers" },
      {
        name: "description",
        content: "Post jobs and hire blue-collar talent across India. Free to register.",
      },
    ],
  }),
  component: EmployerSignupPage,
});

const COMPANY_TYPES = [
  { v: "proprietorship", l: "Proprietorship" },
  { v: "pvt_ltd", l: "Private Limited" },
  { v: "llp", l: "LLP" },
  { v: "public_ltd", l: "Public Limited" },
  { v: "ngo", l: "NGO / Trust" },
  { v: "government", l: "Government" },
];
const SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"];
const INDUSTRIES = [
  "Retail & E-commerce", "Logistics & Delivery", "BFSI", "IT & ITES",
  "Manufacturing", "Healthcare", "Education", "Hospitality", "Construction",
  "Real Estate", "Telecom", "Automotive", "Food & Beverages", "Security Services",
  "Facility Management", "Agriculture", "Media & Entertainment", "Travel & Tourism",
  "Energy", "NGO / Social", "Government", "Other",
];
const CITIES = ["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad", "Jaipur", "Lucknow", "Indore", "Chandigarh", "Coimbatore"];

const BENEFITS = [
  { icon: Sparkles, t: "AI-recommended candidates", d: "Get matched profiles even before you search." },
  { icon: Users, t: "50 lakh+ candidate pool", d: "Active blue-collar and grey-collar workers across India." },
  { icon: Zap, t: "Boost jobs for top visibility", d: "Premium placement when you need urgent hires." },
  { icon: ShieldCheck, t: "Verified employers only", d: "GST & CIN-verified companies build candidate trust." },
];

function EmployerSignupPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [primaryCity, setPrimaryCity] = useState("");
  const [pincode, setPincode] = useState("");

  const validate = () => {
    if (!fullName.trim()) return "Please enter your full name.";
    if (!/^[6-9]\d{9}$/.test(mobile)) return "Enter a valid 10-digit Indian mobile number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid work email.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (!companyName.trim()) return "Please enter your company name.";
    if (!companyType) return "Please pick a company type.";
    if (!industry) return "Please select an industry.";
    if (!size) return "Please pick company size.";
    if (!primaryCity) return "Please pick a hiring city.";
    if (!/^\d{6}$/.test(pincode)) return "Please enter a 6-digit pincode.";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) return toast.error(err);
    setLoading(true);
    try {
      await signUpEmployer({
        fullName: fullName.trim(),
        email: email.trim(),
        mobile: `+91${mobile}`,
        password,
        company: {
          name: companyName.trim(),
          companyType,
          industry,
          size,
          website: website.trim(),
          description: description.trim(),
          primaryCity,
          pincode,
        },
      });
      toast.success("Welcome to JobsKart! Setting up your dashboard…");
      navigate({ to: "/employer/dashboard" });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not create account.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      const res = await signInWithGoogle("employer");
      if (!res.redirected) {
        toast.success("Signed up with Google! Add your company next.");
        navigate({ to: "/employer/dashboard" });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <AuthShell side="employer">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Register your company</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Free to start — hire from India's largest blue-collar talent pool.
        </p>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={googleLoading}
          className="mt-6 inline-flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-border bg-card text-sm font-semibold text-foreground transition-colors hover:bg-surface disabled:opacity-60"
        >
          {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
          Continue with Google
        </button>

        <form onSubmit={handleSubmit} className="mt-6 space-y-6">
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              1. Admin account
            </h2>
            <div className="mt-3 space-y-4">
              <Field label="Full Name" required>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="form-input" placeholder="Priya Verma" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Mobile" required>
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
                <Field label="Work Email" required>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="form-input" placeholder="priya@company.com" />
                </Field>
              </div>
              <Field label="Password" required hint="Min 8 characters">
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="form-input pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label="Toggle password"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              2. Company details
            </h2>
            <div className="mt-3 space-y-4">
              <Field label="Company Name" required>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="form-input" placeholder="BrightMart Retail Pvt Ltd" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Company Type" required>
                  <select value={companyType} onChange={(e) => setCompanyType(e.target.value)} className="form-input">
                    <option value="">Select…</option>
                    {COMPANY_TYPES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
                  </select>
                </Field>
                <Field label="Company Size" required>
                  <select value={size} onChange={(e) => setSize(e.target.value)} className="form-input">
                    <option value="">Select…</option>
                    {SIZES.map((s) => <option key={s} value={s}>{s} employees</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Industry" required>
                <select value={industry} onChange={(e) => setIndustry(e.target.value)} className="form-input">
                  <option value="">Select…</option>
                  {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>
              <Field label="Website (optional)">
                <input value={website} onChange={(e) => setWebsite(e.target.value)} className="form-input" placeholder="https://yourcompany.com" />
              </Field>
              <Field label="About the company (optional)" hint={`${description.length}/500`}>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="form-input resize-none"
                  placeholder="A short pitch — what you do, where you operate, what makes you a great place to work."
                />
              </Field>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              3. Hiring location
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Primary City" required>
                <select value={primaryCity} onChange={(e) => setPrimaryCity(e.target.value)} className="form-input">
                  <option value="">Select…</option>
                  {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Pincode" required>
                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))}
                  className="form-input"
                  placeholder="400001"
                />
              </Field>
            </div>
          </section>

          {/* Why JobsKart sticky benefits */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-semibold text-foreground">Why post on JobsKart?</p>
            <ul className="mt-3 space-y-2.5">
              {BENEFITS.map((b) => (
                <li key={b.t} className="flex items-start gap-3 text-sm">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-light text-primary">
                    <b.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{b.t}</p>
                    <p className="text-xs text-muted-foreground">{b.d}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-dark disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Employer Account
          </button>
          <p className="text-center text-xs text-muted-foreground">
            By registering you agree to our{" "}
            <a href="#" className="underline">Terms of Service</a> and{" "}
            <a href="#" className="underline">Privacy Policy</a>.
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/auth" search={{ tab: "employer" }} className="font-semibold text-primary hover:text-primary-dark">
            Employer log in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
