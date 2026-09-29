-- ============================================================
-- OTP Verifications Table for Real OTP Provider (Msg91)
-- ============================================================
-- Phase 4 of Flow 4: Real OTP Provider Integration

CREATE TABLE IF NOT EXISTS public.otp_verifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mobile text NOT NULL,                    -- E.164 format without + (e.g., 919876543210)
    otp_hash text NOT NULL,                  -- bcrypt hash of OTP (or plaintext for dev)
    channel text NOT NULL DEFAULT 'sms',     -- 'sms' | 'whatsapp'
    expires_at timestamptz NOT NULL,
    attempts int NOT NULL DEFAULT 0,
    verified boolean NOT NULL DEFAULT false,
    verified_at timestamptz,
    metadata jsonb DEFAULT '{}',             -- { user_type: 'candidate' | 'employer' }
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_verifications_mobile 
    ON public.otp_verifications (mobile, channel, verified, expires_at);

ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY;

-- Only service role can manage OTP records (via Edge Functions)
CREATE POLICY "Service role full access" ON public.otp_verifications
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users can only read their own OTP status (for polling)
CREATE POLICY "Users can read own OTP" ON public.otp_verifications
    FOR SELECT TO authenticated
    USING (mobile = (SELECT mobile FROM public.profiles WHERE id = auth.uid()));

GRANT ALL ON public.otp_verifications TO service_role;
GRANT SELECT ON public.otp_verifications TO authenticated;

-- Cleanup function for expired OTPs
CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.otp_verifications
    WHERE expires_at < now() OR verified = true;
    RETURN ROW_COUNT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_otps() TO service_role;

-- Schedule cleanup via pg_cron (run every hour)
-- SELECT cron.schedule('cleanup-otps-hourly', '0 * * * *', 'SELECT public.cleanup_expired_otps();');