import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Headers for CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // For production, you should lock this to your domain: 'https://aidashirazi.ir'
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { document_type_id } = await req.json()
    if (!document_type_id) throw new Error('Document type ID is required.')

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: { user } } = await supabaseAdmin.auth.getUser()
    if (!user) throw new Error('User not authenticated.')

    const merchantCode = Deno.env.get('ZIBAL_MERCHANT_CODE')
    if (!merchantCode) throw new Error('Zibal merchant code not configured.')

    // In a real app, you would fetch the price from the database based on document_type_id
    const amount = 1000000; // 100,000 Toman in Rials

    const payload = {
      merchant: merchantCode,
      amount: amount,
      callbackUrl: `https://aidashirazi.ir/documents?payment_status=success&doc_id=${document_type_id}`,
      description: `خرید سند شماره ${document_type_id}`,
      orderId: `uid-${user.id}-dtid-${document_type_id}-ts-${Date.now()}`
    }

    const zibalResponse = await fetch('https://gateway.zibal.ir/v1/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(res => res.json())

    if (zibalResponse.result !== 100) {
      throw new Error(`Zibal API error: ${zibalResponse.message} (code: ${zibalResponse.result})`)
    }

    return new Response(JSON.stringify({ payment_url: `https://gateway.zibal.ir/start/${zibalResponse.trackId}` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

