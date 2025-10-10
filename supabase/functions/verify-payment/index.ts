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
    const { trackId, orderId } = await req.json();
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) throw new Error("Authentication header missing.");
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
      
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("User not found or invalid token.");

    const merchant_code = Deno.env.get("ZIBAL_MERCHANT_CODE");
    const zibal_verify_url = "https://gateway.zibal.ir/v1/verify";

    const response = await fetch(zibal_verify_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            merchant: merchant_code,
            trackId,
        }),
    });

    const data = await response.json();
    
    if (data.result === 100) { // Payment is successful
      const documentTypeId = parseInt(orderId);
      const { error: insertError } = await supabaseClient
        .from('user_purchases')
        .insert({ user_id: user.id, document_type_id: documentTypeId });

      if (insertError) {
        console.error("Database insert error:", insertError.message);
        throw new Error("Payment was successful but failed to save the purchase record.");
      }

      return new Response(JSON.stringify({ success: true, message: "پرداخت موفق بود و خرید شما ثبت شد." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });

    } else {
      throw new Error(`Payment verification failed: ${data.message} (Code: ${data.result})`);
    }

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
