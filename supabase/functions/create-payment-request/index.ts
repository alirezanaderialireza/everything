import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const ZIBAL_MERCHANT_CODE = Deno.env.get("ZIBAL_MERCHANT_CODE");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

serve(async (req: Request) => {
  // This is needed to handle CORS preflight requests.
  // The browser sends this OPTIONS request first to check if it's safe to send the real request.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { documentTypeId } = await req.json();
    if (!documentTypeId) throw new Error("شناسه سند (documentTypeId) ارسال نشده است.");

    const callbackUrl = `${SUPABASE_URL}/functions/v1/verify-zibal-payment?type_id=${documentTypeId}`;

    const payload = {
      merchant: ZIBAL_MERCHANT_CODE,
      amount: 1000000, // 100,000 Toman in Rials
      callbackUrl: callbackUrl,
      description: `خرید مجموعه اسناد شماره ${documentTypeId}`,
    };

    const zibalResponse = await fetch("https://gateway.zibal.ir/v1/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    const zibalResult = await zibalResponse.json();

    if (zibalResult.result !== 100) {
      throw new Error(`خطا از درگاه پرداخت: ${zibalResult.message}`);
    }

    const paymentUrl = `https://gateway.zibal.ir/start/${zibalResult.trackId}`;

    return new Response(JSON.stringify({ paymentUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});

