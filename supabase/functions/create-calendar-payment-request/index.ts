// supabase/functions/create-calendar-payment-request/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const BASE_PRICE_TOMAN = 50000; // قیمت پایه محصول

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { gateway, userInfo, discountCode } = await req.json();

    if (!gateway || !userInfo) {
      throw new Error("اطلاعات ارسالی از کلاینت ناقص است.");
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization")!;
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("کاربر شناسایی نشد.");

    // --- محاسبه قیمت نهایی در سمت سرور (بخش امنیتی کلیدی) ---
    let finalPrice = BASE_PRICE_TOMAN;
    let discountPercent = 0;

    if (discountCode) {
      const { data: discount, error } = await supabaseAdmin
        .from("discount_codes")
        .select("discount_percent, is_active")
        .eq("code", discountCode.toUpperCase())
        .eq("product_type", "calendar")
        .single();
      
      // فقط اگر کد معتبر و فعال بود، تخفیف را اعمال کن
      if (discount && discount.is_active) {
        discountPercent = discount.discount_percent;
        finalPrice = BASE_PRICE_TOMAN * (1 - discountPercent / 100);
      }
    }
    // ----------------------------------------------------------------

    await supabaseAdmin.from("profiles").update({ full_name: userInfo.fullName, mobile: userInfo.mobile }).eq("id", user.id);

    const { data: transaction, error: insertError } = await supabaseAdmin
      .from("pending_transactions")
      .insert({
        user_id: user.id,
        gateway: gateway,
        product_type: 'calendar',
        final_amount: finalPrice // قیمت نهایی را هم در تراکنش ذخیره می‌کنیم (ستون جدید)
      })
      .select()
      .single();

    if (insertError) throw insertError;
    
    let paymentUrl = "";
    const amountInRial = Math.round(finalPrice * 10);

    // ... (منطق درگاه‌های پرداخت مثل قبل باقی می‌ماند، فقط از amountInRial استفاده می‌کنند) ...
    if (gateway === "zibal") {
        const zibalResponse = await fetch("https://gateway.zibal.ir/v1/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                merchant: Deno.env.get("ZIBAL_MERCHANT_CODE"),
                amount: amountInRial,
                description: `خرید تقویم پیشرفته - با تخفیف ${discountPercent}%`,
                orderId: transaction.id,
                callbackUrl: `https://aidashirazi.ir/payment/verify-calendar-zibal`,
                mobile: userInfo.mobile,
            }),
        });
        const zibalData = await zibalResponse.json();
        if (zibalData.result !== 100) throw new Error(`Zibal Error: ${zibalData.message}`);
        paymentUrl = `https://gateway.zibal.ir/start/${zibalData.trackId}`;
    }

    else if (gateway === "bitpay") {
        const redirectUrl = `https://aidashirazi.ir/payment/verify-calendar-bitpay`;
        const params = new URLSearchParams();
        params.append("api", Deno.env.get("BITPAY_API_TOKEN")!);
        params.append("amount", amountInRial.toString());
        params.append("redirect", redirectUrl);
        params.append("factorId", transaction.id.toString());
        // ... (بقیه پارامترهای بیت‌پی)
        
        const bitpayResponse = await fetch("https://bitpay.ir/payment/gateway-send", { /* ... */ });
        // ... (بقیه منطق بیت‌پی)
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