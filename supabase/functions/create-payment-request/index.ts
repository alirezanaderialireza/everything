import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Headers for CORS to allow requests from your website
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { amount, documentTypeId } = await req.json();
    const user = req.headers.get('Authorization')?.replace('Bearer ', '');

    if (!user) {
      throw new Error("User not authenticated.");
    }

    // This is the URL the user will be sent back to after payment
    // مهم: آدرس دامنه خود را جایگزین کنید
    const callback_url = `https://aidashirazi.ir/documents.html?type_id=${documentTypeId}`;
    
    // Get Zarinpal Merchant ID from Supabase secrets
    const merchant_id = Deno.env.get("ZARINPAL_MERCHANT_ID");
    if (!merchant_id) {
        throw new Error("Zarinpal Merchant ID not set in Supabase secrets.");
    }

    const zarinpal_req_url = "https://api.zarinpal.com/pg/v4/payment/request.json";

    const response = await fetch(zarinpal_req_url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify({
            merchant_id,
            amount,
            callback_url,
            description: `خرید مجموعه اسناد شماره ${documentTypeId}`,
        }),
    });

    const data = await response.json();

    if (data.errors && data.errors.length > 0) {
        throw new Error(`Zarinpal Error: ${data.errors.message}`);
    }
    
    if (data.data.authority) {
        const paymentUrl = `https://www.zarinpal.com/pg/StartPay/${data.data.authority}`;
        return new Response(JSON.stringify({ paymentUrl }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    } else {
        throw new Error("Failed to get payment authority from Zarinpal.");
    }

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});

