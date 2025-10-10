// supabase/functions/create-zibal-request/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// CORS headers are now defined directly inside the function
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://aidashirazi.ir",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ZIBAL_API_URL = "https://gateway.zibal.ir/v1/request";
const PRICE_RIAL = 1000000; // 100,000 Toman in Rials

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { documentTypeId } = await req.json();
    if (!documentTypeId) throw new Error("شناسه محصول ارسال نشده است.");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? "",
    );

    const authHeader = req.headers.get("Authorization")!;
    const { data: { user } } = await _supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) throw new Error("کاربر شناسایی نشد.");

    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("pending_transactions")
      .insert({
        user_id: user.id,
        document_type_id: documentTypeId,
        gateway: "zibal",
      })
      .select()
      .single();

    if (transactionError) throw transactionError;

    const payload = {
      merchant: Deno.env.get("ZIBAL_MERCHANT_CODE"),
      amount: PRICE_RIAL,
      description: `خرید اسناد حسابداری - سفارش ${transaction.id}`,
      orderId: transaction.id,
      callbackUrl: `https://evfgzegtplkhocfxcjpp.supabase.co/functions/v1/verify-zibal-payment`,
    };

    const response = await fetch(ZIBAL_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (result.result !== 100) {
      throw new Error(`خطا از درگاه زیبال: ${result.message}`);
    }

    const paymentUrl = `https://gateway.zibal.ir/start/${result.trackId}`;

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

