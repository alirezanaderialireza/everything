// supabase/functions/create-calendar-payment-request/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const PRICE_TOMAN = 50000; 

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { gateway, userInfo } = await req.json();
    if (!gateway || !userInfo) {
      throw new Error("اطلاعات ارسالی ناقص است.");
    }

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization")!;
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("کاربر شناسایی نشد.");

    await supabaseAdmin.from("profiles").update({ full_name: userInfo.fullName, mobile: userInfo.mobile }).eq("id", user.id);

    const { data: transaction, error: insertError } = await supabaseAdmin
      .from("pending_transactions")
      .insert({
        user_id: user.id,
        document_type_id: null,
        gateway: gateway,
        product_type: 'calendar'
      })
      .select()
      .single();

    if (insertError) throw insertError;
    
    let paymentUrl = "";

    if (gateway === "zibal") {
        const zibalResponse = await fetch("https://gateway.zibal.ir/v1/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                merchant: Deno.env.get("ZIBAL_MERCHANT_CODE"),
                amount: PRICE_TOMAN * 10,
                description: `خرید تقویم پیشرفته - سفارش ${transaction.id}`,
                orderId: transaction.id,
                // آدرس بازگشتی جدید و اختصاصی
                callbackUrl: `https://aidashirazi.ir/payment/verify-calendar-zibal`,
                mobile: userInfo.mobile,
            }),
        });
        const zibalData = await zibalResponse.json();
        if (zibalData.result !== 100) throw new Error(`Zibal Error: ${zibalData.message}`);
        paymentUrl = `https://gateway.zibal.ir/start/${zibalData.trackId}`;
    }

    else if (gateway === "bitpay") {
        // آدرس بازگشتی جدید و اختصاصی
        const redirectUrl = `https://aidashirazi.ir/payment/verify-calendar-bitpay`;
        const params = new URLSearchParams();
        params.append("api", Deno.env.get("BITPAY_API_TOKEN")!);
        params.append("amount", (PRICE_TOMAN * 10).toString());
        params.append("redirect", redirectUrl);
        params.append("factorId", transaction.id.toString());
        params.append("name", userInfo.fullName);
        params.append("email", user.email || "");
        
        const bitpayResponse = await fetch("https://bitpay.ir/payment/gateway-send", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params,
        });
        const responseText = await bitpayResponse.text();
        const id_get = parseInt(responseText, 10);
        if (isNaN(id_get) || id_get <= 0) throw new Error(`BitPay Send Error: ${responseText}`);
        paymentUrl = `https://bitpay.ir/payment/gateway-${id_get}-get`;
    }

    return new Response(JSON.stringify({ paymentUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});