import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export type SignupUserType = "candidate" | "employer";

export interface CandidateSignupInput {
  fullName: string;
  email: string;
  mobile: string;
  password: string;
  city: string;
}

export interface EmployerSignupInput {
  fullName: string;
  email: string;
  mobile: string;
  password: string;
  company: {
    name: string;
    companyType: string;
    industry: string;
    size: string;
    website?: string;
    description?: string;
    primaryCity: string;
    pincode: string;
  };
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpCandidate(input: CandidateSignupInput) {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${window.location.origin}/candidate/dashboard`,
      data: {
        user_type: "candidate",
        full_name: input.fullName,
        mobile: input.mobile,
      },
    },
  });
  if (error) throw error;

  // Best-effort: set city on profile after the trigger creates it.
  if (data.user) {
    await supabase
      .from("profiles")
      .update({ city: input.city })
      .eq("id", data.user.id);
  }
  return data;
}

export async function signUpEmployer(input: EmployerSignupInput) {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${window.location.origin}/employer/dashboard`,
      data: {
        user_type: "employer",
        full_name: input.fullName,
        mobile: input.mobile,
      },
    },
  });
  if (error) throw error;
  if (!data.user) throw new Error("Signup did not return a user. Try logging in.");

  const userId = data.user.id;

  // Create company
  const { data: company, error: cErr } = await supabase
    .from("companies")
    .insert({
      name: input.company.name,
      company_type: input.company.companyType as never,
      industry: input.company.industry,
      size: input.company.size as never,
      website: input.company.website || null,
      description: input.company.description || null,
      primary_city: input.company.primaryCity,
      pincode: input.company.pincode,
      created_by: userId,
    })
    .select()
    .single();
  if (cErr) throw cErr;

  // Add the user as Super Admin
  const { error: mErr } = await supabase.from("employer_members").insert({
    user_id: userId,
    company_id: company.id,
    role: "super_admin",
  });
  if (mErr) throw mErr;

  return { user: data.user, company };
}

export async function signInWithGoogle(userType: SignupUserType = "candidate") {
  const redirectBase =
    typeof window !== "undefined" ? window.location.origin : undefined;
  const result = await lovable.auth.signInWithOAuth("google", {
    redirect_uri: redirectBase,
    extraParams: { prompt: "select_account" },
  });
  if (result.error) throw result.error;

  // After non-redirect success, persist desired user_type for the new account
  // (the trigger reads raw_user_meta_data on first insert).
  if (!result.redirected) {
    try {
      await supabase.auth.updateUser({ data: { user_type: userType } });
    } catch {
      /* noop */
    }
  }
  return result;
}

export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw error;
}

export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
