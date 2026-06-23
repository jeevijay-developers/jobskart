import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Building2, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Navbar } from "@/components/site/Navbar";
import { supabase } from "@/integrations/supabase/client";
import { setActiveCompanyId } from "@/lib/employer";
import { INDIAN_CITIES } from "@/lib/options";

export const Route = createFileRoute("/_authenticated/onboarding/employer")({
  head: () => ({ meta: [{ title: "Set up your company · JobsKart" }] }),
  component: EmployerOnboarding,
});

function EmployerOnboarding() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [fullName, setFullName] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState<"1-10" | "11-50" | "51-200" | "201-500" | "500+">("11-50");
  const [city, setCity] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !fullName.trim() || !city) {
      toast.error("Please complete the required fields.");
      return;
    }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in.");

      // Update profile name
      await supabase.from("profiles").update({ full_name: fullName }).eq("id", uid);

      // Create company
      const { data: company, error: cErr } = await supabase
        .from("companies")
        .insert({
          name: name.trim(),
          industry: industry || null,
          size,
          hq_city: city,
          primary_city: city,
          website: website || null,
          created_by: uid,
          onboarding_completed: true,
        })
        .select("id")
        .single();
      if (cErr || !company) throw cErr ?? new Error("Could not create company.");

      // Add membership
      const { error: mErr } = await supabase.from("employer_members").insert({
        user_id: uid,
        company_id: company.id,
        role: "super_admin",
      });
      if (mErr) throw mErr;

      setActiveCompanyId(company.id);
      toast.success(`${name} is ready — let's post your first job.`);
      navigate({ to: "/employer/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
          <Building2 className="h-3.5 w-3.5" /> Set up your company
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">
          Tell us about your business
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We'll create your hiring workspace — you can edit any of this later.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name" required>
              <input
                className="form-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Vikas Sharma"
              />
            </Field>
            <Field label="Company name" required>
              <input
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Logistics Pvt Ltd"
              />
            </Field>
            <Field label="Industry">
              <input
                className="form-input"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Logistics, IT, Retail…"
              />
            </Field>
            <Field label="Company size">
              <select
                className="form-input"
                value={size}
                onChange={(e) => setSize(e.target.value as typeof size)}
              >
                <option value="1-10">1–10</option>
                <option value="11-50">11–50</option>
                <option value="51-200">51–200</option>
                <option value="201-500">201–500</option>
                <option value="500+">500+</option>
              </select>
            </Field>
            <Field label="Headquarters city" required>
              <select className="form-input" value={city} onChange={(e) => setCity(e.target.value)}>
                <option value="">Select city</option>
                {INDIAN_CITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Website">
              <input
                className="form-input"
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://"
              />
            </Field>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-dark disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ArrowRight className="h-4 w-4" /></>}
          </button>
        </form>
      </main>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-foreground">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
