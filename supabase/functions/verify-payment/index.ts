import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ZIBAL_MERCHANT_CODE = Deno.env.get("ZIBAL_MERCHANT_CODE");

serve(async (req: Request) => {
  // This is needed if you're planning to invoke your function from a browser.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { trackId, success, documentTypeId } = await req.json();
    const authHeader = req.headers.get("Authorization")!;
    
    if (success !== "1") {
        throw new Error("تراکنش توسط کاربر لغو شد یا ناموفق بود.");
    }

    // Verify the payment with Zibal
    const zibalPayload = {
      merchant: ZIBAL_MERCHANT_CODE,
      trackId: trackId,
    };

    const zibalResponse = await fetch("https://gateway.zibal.ir/v1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(zibalPayload),
    });

    const zibalResult = await zibalResponse.json();

    if (zibalResult.result !== 100) {
      throw new Error(`خطا در تایید پرداخت: ${zibalResult.message}`);
    }

    // Payment is verified, now insert into the database
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
      
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("کاربر شناسایی نشد.");

    const { error: dbError } = await supabase
      .from("user_purchases")
      .insert({ user_id: user.id, document_type_id: documentTypeId });

    if (dbError) {
        // Handle cases where the user might have already purchased this item
        if (dbError.code === '23505') { // Unique violation
            console.warn(`User ${user.id} already purchased item ${documentTypeId}. Verification successful anyway.`);
        } else {
            throw dbError;
        }
    }

    return new Response(JSON.stringify({ success: true, message: "پرداخت با موفقیت تایید و ثبت شد." }), {
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

