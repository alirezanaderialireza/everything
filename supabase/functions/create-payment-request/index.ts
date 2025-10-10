import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const ZIBAL_MERCHANT_CODE = Deno.env.get("ZIBAL_MERCHANT_CODE");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

serve(async (req: Request) => {
  // This is needed if you're planning to invoke your function from a browser.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { documentTypeId } = await req.json();

    if (!documentTypeId) {
      throw new Error("Document Type ID is required.");
    }
    
    // In a real app, you might fetch the price from the database
    // For now, we use a fixed price of 100,000 Toman (1,000,000 Rials)
    const amount = 1000000; 

    // Construct the callback URL
    const callbackUrl = `${req.headers.get("origin")}/documents.html?type_id=${documentTypeId}`;

    const zibalPayload = {
      merchant: ZIBAL_MERCHANT_CODE,
      amount: amount,
      callbackUrl: callbackUrl,
      description: `خرید اسناد حسابداری - نوع: ${documentTypeId}`,
    };

    const zibalResponse = await fetch("https://gateway.zibal.ir/v1/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(zibalPayload),
    });

    const zibalResult = await zibalResponse.json();

    if (zibalResult.result !== 100) {
      throw new Error(`خطا از درگاه پرداخت زیبال: ${zibalResult.message}`);
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

