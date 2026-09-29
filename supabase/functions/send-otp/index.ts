import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface SendOTPRequest {
  mobile: string
  channel?: 'sms' | 'whatsapp'
  template_id?: string
  user_type?: 'candidate' | 'employer'
}

interface Msg91Response {
  type: string
  message: string
  request_id?: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const msg91AuthKey = Deno.env.get('MSG91_AUTH_KEY')!
    const msg91TemplateId = Deno.env.get('MSG91_TEMPLATE_ID')!
    const msg91SenderId = Deno.env.get('MSG91_SENDER_ID') || 'JBSKRT'
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { mobile, channel = 'sms', template_id, user_type }: SendOTPRequest = await req.json()

    // Validate mobile number (Indian format)
    const cleanMobile = mobile.replace(/\D/g, '')
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      return new Response(
        JSON.stringify({ error: 'Invalid mobile number format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Store OTP in database (using service role to bypass RLS)
    const { error: insertError } = await supabase
      .from('otp_verifications')
      .insert({
        mobile: cleanMobile,
        otp_hash: otp, // In production, hash this: await bcrypt.hash(otp, 10)
        channel,
        expires_at: expiresAt.toISOString(),
        attempts: 0,
        metadata: { user_type }
      })

    if (insertError) {
      console.error('OTP insert error:', insertError)
      return new Response(
        JSON.stringify({ error: 'Failed to store OTP' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Send via Msg91
    const templateId = template_id || msg91TemplateId
    const msg91Url = `https://api.msg91.com/api/v5/otp?template_id=${templateId}&mobile=91${cleanMobile}&authkey=${msg91AuthKey}&otp=${otp}&sender=${msg91SenderId}`

    const msg91Response = await fetch(msg91Url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })

    const msg91Data: Msg91Response = await msg91Response.json()

    if (!msg91Response.ok || msg91Data.type === 'error') {
      console.error('Msg91 error:', msg91Data)
      // Don't expose internal error details
      return new Response(
        JSON.stringify({ error: 'Failed to send OTP. Please try again.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'OTP sent successfully',
        request_id: msg91Data.request_id,
        expires_in: 600 // seconds
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})