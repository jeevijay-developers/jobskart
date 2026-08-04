import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number."),
  otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
  userType: z.enum(["candidate", "employer"]),
});

/**
 * Mobile + OTP login that auto-creates the account on first sign-in.
 *
 * Demo: accepts any 6-digit OTP. Replace with a real SMS provider in production.
 *
 * Behavior:
 *  - profile exists & user_type matches → mint magic link, return as existing user
 *  - profile exists but user_type differs → error
 *  - no profile → create auth user + profile (via handle_new_user trigger) with the
 *    selected role, then mint magic link and return as new user
 */
export const loginOrCreateWithMobile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const { mobile, otp, userType } = data;

    if (!/^\d{6}$/.test(otp)) {
      throw new Error("Invalid OTP.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const phoneWithCode = `+91${mobile}`;
    const syntheticEmail = `m${mobile}@jobskart.app`;

    // 1. Look up existing profile (by either stored mobile shape)
    const { data: profiles, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, user_type, mobile")
      .or(`mobile.eq.${phoneWithCode},mobile.eq.${mobile}`)
      .limit(1);
    if (profileErr) throw new Error(profileErr.message);

    let profile = profiles?.[0] ?? null;
    let isNew = false;

    // If the number is registered under the other role, sign them into their
    // existing role instead of failing — the client routes by the returned userType.
    const roleSwitched = !!profile && profile.user_type !== userType;


    // 2. If no profile, check whether an auth user already exists for this number
    //    (e.g. seeded admin) before creating a new one.
    if (!profile) {
      // Direct lookup against auth.users via SECURITY DEFINER RPC — scales beyond 200 users.
      let existingAuthUser:
        | { id: string; email: string | null; phone: string | null }
        | null = null;

      const { data: rpcRows, error: rpcErr } = await (
        supabaseAdmin.rpc as unknown as (
          fn: string,
          args: Record<string, string>,
        ) => Promise<{ data: Array<{ id: string; email: string | null; phone: string | null }> | null; error: unknown }>
      )("find_auth_user_by_phone_or_email", { _phone: phoneWithCode, _email: syntheticEmail });
      if (!rpcErr && Array.isArray(rpcRows) && rpcRows.length) {
        existingAuthUser = rpcRows[0];
      } else {
        // Fallback: scan the first page of auth users if the RPC is unavailable.
        const { data: list } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });
        const u = list?.users.find(
          (x) =>
            x.phone === phoneWithCode ||
            x.phone === mobile ||
            x.email === syntheticEmail,
        );
        if (u) existingAuthUser = { id: u.id, email: u.email ?? null, phone: u.phone ?? null };
      }

      if (existingAuthUser) {
        // Auth user exists but no profile row — backfill profile and continue.
        const emailForLink = existingAuthUser.email || syntheticEmail;
        await supabaseAdmin
          .from("profiles")
          .upsert({
            id: existingAuthUser.id,
            email: emailForLink,
            mobile: phoneWithCode,
            user_type: userType,
            full_name: "",
          });
        profile = {
          id: existingAuthUser.id,
          email: emailForLink,
          user_type: userType,
          mobile: phoneWithCode,
        };
      } else {
        isNew = true;
        const { data: created, error: createErr } =
          await supabaseAdmin.auth.admin.createUser({
            email: syntheticEmail,
            email_confirm: true,
            phone: phoneWithCode,
            user_metadata: {
              mobile: phoneWithCode,
              user_type: userType,
              full_name: "",
            },
          });
        if (createErr || !created.user) {
          throw new Error(createErr?.message ?? "Could not create account.");
        }
        profile = {
          id: created.user.id,
          email: syntheticEmail,
          user_type: userType,
          mobile: phoneWithCode,
        };
      }
    }

    if (!profile.email) {
      throw new Error("Account is missing an email on file. Contact support.");
    }

    // 3. Mint a magic link for the client to verify
    const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: profile.email,
    });
    if (linkErr) throw new Error(linkErr.message);
    const tokenHash = link?.properties?.hashed_token;
    if (!tokenHash) throw new Error("Could not issue session token.");

    return {
      email: profile.email,
      tokenHash,
      userType: profile.user_type as "candidate" | "employer",
      isNew,
      roleSwitched,
    };

  });

// Backwards-compat alias for existing callers
export const loginWithMobileOtp = loginOrCreateWithMobile;
