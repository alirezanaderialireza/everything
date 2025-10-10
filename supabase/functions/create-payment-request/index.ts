import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { amount, documentTypeId } = await req.json();

    // مهم: آدرس دامنه خود را اینجا وارد کنید
    const callback_url = `https://aidashirazi.ir/documents.html`;
    
    // دریافت کد مرچنت زیبال از متغیرهای محرمانه
    const merchant_code = Deno.env.get("ZIBAL_MERCHANT_CODE");
    if (!merchant_code) {
        throw new Error("Zibal Merchant Code not set in Supabase secrets.");
    }

    const zibal_req_url = "https://gateway.zibal.ir/v1/request";

    const response = await fetch(zibal_req_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            merchant: merchant_code,
            amount: amount * 10, // مبلغ به ریال است
            callbackUrl: callback_url,
            orderId: documentTypeId.toString(),
            description: `خرید مجموعه اسناد شماره ${documentTypeId}`,
        }),
    });

    const data = await response.json();

    if (data.result !== 100) {
        throw new Error(`Zibal Error: ${data.message} (Code: ${data.result})`);
    }
    
    const paymentUrl = `https://gateway.zibal.ir/start/${data.trackId}`;
    return new Response(JSON.stringify({ paymentUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
