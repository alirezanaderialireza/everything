import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { authority, amount, documentTypeId } = await req.json();
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
      throw new Error("Authentication header missing.");
    }
    
    // Create a Supabase client with the user's token to perform actions on their behalf
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
      
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        throw new Error("User not found or invalid token.");
    }

    const merchant_id = Deno.env.get("ZARINPAL_MERCHANT_ID");
    const zarinpal_verify_url = "https://api.zarinpal.com/pg/v4/payment/verify.json";

    const response = await fetch(zarinpal_verify_url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify({
            merchant_id,
            amount,
            authority,
        }),
    });

    const data = await response.json();
    
    if (data.data && data.data.code === 100) {
      // Payment is successful, now add the purchase to the database
      const { error: insertError } = await supabaseClient
        .from('user_purchases')
        .insert({ user_id: user.id, document_type_id: documentTypeId });

      if (insertError) {
        // Handle potential duplicate inserts or other DB errors
        console.error("Database insert error:", insertError.message);
        throw new Error("Payment was successful but failed to save the purchase record.");
      }

      return new Response(JSON.stringify({ success: true, message: "پرداخت موفقیت‌آمیز بود و خرید شما ثبت شد." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });

    } else {
      throw new Error(`Payment verification failed: ${data.errors.message}`);
    }

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
