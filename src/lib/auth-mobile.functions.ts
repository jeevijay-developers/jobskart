import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number."),
  otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
  userType: z.enum(["candidate", "employer"]),
});

/**
 * STUB mobile + OTP login.
 * Accepts any 6-digit OTP (or "123456"). In production replace with a real
 * SMS provider + signInWithOtp({ phone }).
 *
 * Looks up the account by mobile in profiles, then mints a one-time
 * magic-link token using the admin API which the client verifies to
 * establish a session.
 */
export const loginWithMobileOtp = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const { mobile, otp, userType } = data;

    // Stub OTP gate. Accept 123456 always, or any other 6 digits.
    if (!/^\d{6}$/.test(otp)) {
      throw new Error("Invalid OTP.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const phoneWithCode = `+91${mobile}`;

    // Find profile by mobile (with or without +91 prefix).
    const { data: profiles, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, user_type, mobile")
      .or(`mobile.eq.${phoneWithCode},mobile.eq.${mobile}`)
      .limit(1);

    if (profileErr) throw new Error(profileErr.message);
    const profile = profiles?.[0];
    if (!profile) {
      throw new Error("No account found for this mobile number. Please sign up first.");
    }

    if (profile.user_type !== userType) {
      throw new Error(
        `This number is registered as a ${profile.user_type}. Switch the tab and try again.`,
      );
    }

    if (!profile.email) {
      throw new Error("Account is missing an email on file. Contact support.");
    }

    // Mint a magic link the client can verify to obtain a session.
    const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: profile.email,
    });
    if (linkErr) throw new Error(linkErr.message);

    const tokenHash = link?.properties?.hashed_token;
    if (!tokenHash) throw new Error("Could not issue session token.");

    return { email: profile.email, tokenHash, userType: profile.user_type };
  });
