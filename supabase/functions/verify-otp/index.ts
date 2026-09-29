import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface VerifyOTPRequest {
  mobile: string
  otp: string
  channel?: 'sms' | 'whatsapp'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { mobile, otp, channel = 'sms' }: VerifyOTPRequest = await req.json()

    const cleanMobile = mobile.replace(/\D/g, '')
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      return new Response(
        JSON.stringify({ error: 'Invalid mobile number format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!/^\d{6}$/.test(otp)) {
      return new Response(
        JSON.stringify({ error: 'Invalid OTP format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Find the most recent valid OTP for this mobile
    const { data: otpRecord, error: fetchError } = await supabase
      .from('otp_verifications')
      .select('*')
      .eq('mobile', cleanMobile)
      .eq('channel', channel)
      .eq('verified', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (fetchError || !otpRecord) {
      return new Response(
        JSON.stringify({ error: 'OTP expired or not found. Please request a new one.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check attempt limit (max 3 attempts)
    if (otpRecord.attempts >= 3) {
      return new Response(
        JSON.stringify({ error: 'Maximum attempts exceeded. Please request a new OTP.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify OTP (in production, use bcrypt.compare(otp, otpRecord.otp_hash))
    const isValid = otpRecord.otp_hash === otp

    // Increment attempts
    await supabase
      .from('otp_verifications')
      .update({ attempts: otpRecord.attempts + 1 })
      .eq('id', otpRecord.id)

    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Invalid OTP', attempts_remaining: 3 - otpRecord.attempts - 1 }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Mark as verified
    await supabase
      .from('otp_verifications')
      .update({ verified: true, verified_at: new Date().toISOString() })
      .eq('id', otpRecord.id)

    // Return success with user info if exists
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, user_type, full_name, email')
      .eq('mobile', cleanMobile)
      .single()

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'OTP verified successfully',
        user: profile ? { id: profile.id, user_type: profile.user_type, full_name: profile.full_name, email: profile.email } : null
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Verify OTP error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})