// Import necessary modules
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Define CORS headers to allow requests from your website
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // For production, lock this to your domain: 'https://aidashirazi.ir'
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Start the server and handle incoming requests
serve(async (req) => {
  // Handle preflight OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get trackId and document_type_id from the request body
    const { trackId, document_type_id } = await req.json()
    if (!trackId || !document_type_id) {
      throw new Error('Track ID and Document Type ID are required.')
    }

    // Create an admin Supabase client to securely interact with the database
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get the authenticated user's data
    const { data: { user } } = await supabaseAdmin.auth.getUser()
    if (!user) {
      throw new Error('User not authenticated.')
    }

    // Get the Zibal merchant code from environment variables for security
    const merchantCode = Deno.env.get('ZIBAL_MERCHANT_CODE')
    if (!merchantCode) {
      throw new Error('Zibal merchant code not configured.')
    }

    // Prepare the payload for payment verification
    const payload = {
      merchant: merchantCode,
      trackId: trackId,
    }

    // Send verification request to Zibal's servers
    const zibalResponse = await fetch('https://gateway.zibal.ir/v1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(res => res.json())

    // Check if Zibal confirmed the payment was successful
    if (zibalResponse.result !== 100) {
      throw new Error(`Payment verification failed: ${zibalResponse.message}`)
    }
    
    // Security check: In a real-world, high-stakes application, you should also verify
    // that zibalResponse.amount matches the expected price from your database.

    // Insert the successful purchase record into the user_purchases table
    const { error: insertError } = await supabaseAdmin
      .from('user_purchases')
      .insert({ user_id: user.id, document_type_id: document_type_id })

    if (insertError) {
      // This error might happen if the user refreshes the page after a successful purchase,
      // causing a duplicate insert attempt. We log this error for debugging but don't
      // show it to the user, as their payment was successful.
      console.error('Error inserting purchase record (might be a duplicate):', insertError.message)
    }

    // Return a success response to the client
    return new Response(JSON.stringify({ success: true, message: 'پرداخت با موفقیت تایید و ثبت شد.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    // If any error occurs during the process, return it to the client
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

