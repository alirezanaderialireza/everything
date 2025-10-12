// supabase/functions/create-payment-request/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const PRICE_TOMAN = 100000;

serve(async (req) => {
  console.log("--- create-payment-request function invoked ---");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { documentTypeId, gateway, userInfo } = await req.json();

    if (!documentTypeId || !gateway || !userInfo) {
      throw new Error("اطلاعات ارسالی از کلاینت ناقص است.");
    }

    // ایجاد کلاینت Supabase
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

    // بررسی هویت کاربر
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (!user) throw new Error("کاربر شناسایی نشد. توکن نامعتبر است.");

    const userId = user.id;
    console.log(`User ${userId} identified successfully.`);

    // به‌روزرسانی اطلاعات پروفایل
    await supabaseAdmin
      .from("profiles")
      .update({
        full_name: userInfo.fullName,
        mobile: userInfo.mobile,
      })
      .eq("id", userId);

    console.log(`Profile for user ${userId} updated.`);

    // ثبت تراکنش در حالت pending
    const { data: transaction, error: insertError } = await supabaseAdmin
      .from("pending_transactions")
      .insert({
        user_id: userId,
        document_type_id: documentTypeId,
        gateway: gateway,
      })
      .select()
      .single();

    if (insertError || !transaction)
      throw new Error("خطا در ثبت تراکنش اولیه در دیتابیس.");

    console.log(`Pending transaction ${transaction.id} created.`);

    let paymentUrl = "";

    // === Zibal Gateway ===
    if (gateway === "zibal") {
      console.log("Initiating Zibal payment...");

      const zibalResponse = await fetch("https://gateway.zibal.ir/v1/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: Deno.env.get("ZIBAL_MERCHANT_CODE"),
          amount: PRICE_TOMAN * 10,
          description: `سفارش ${transaction.id}`,
          orderId: transaction.id,
          callbackUrl: "https://aidashirazi.ir/payment/verify-zibal",
          mobile: userInfo.mobile,
        }),
      });

      const zibalData = await zibalResponse.json();
      console.log("Zibal raw response:", zibalData);

      if (zibalData.result !== 100)
        throw new Error(`Zibal Error: ${zibalData.message}`);

      paymentUrl = `https://gateway.zibal.ir/start/${zibalData.trackId}`;
      console.log("Zibal payment URL created:", paymentUrl);
    }

    // === BitPay Gateway ===
    else if (gateway === "bitpay") {
      console.log("Initiating BitPay payment...");

      const redirectUrl = "https://aidashirazi.ir/payment/verify-bitpay";

      const params = new URLSearchParams();
      params.append("api", Deno.env.get("BITPAY_API_TOKEN")!);
      params.append("amount", (PRICE_TOMAN * 10).toString());
      params.append("redirect", redirectUrl);
      params.append("factorId", transaction.id.toString());
      params.append("name", userInfo.fullName);
      params.append("email", user.email || "");

      const bitpayResponse = await fetch(
        "https://bitpay.ir/payment/gateway-send",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        }
      );

      const responseText = await bitpayResponse.text();
      console.log("BitPay raw response:", responseText);

      const id_get = parseInt(responseText, 10);

      if (isNaN(id_get) || id_get <= 0) {
        throw new Error(`BitPay Send Error: Invalid response code - ${responseText}`);
      }

      paymentUrl = `https://bitpay.ir/payment/gateway-${id_get}-get`;
      console.log("BitPay redirect URL created:", paymentUrl);
    }

    return new Response(JSON.stringify({ paymentUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in create-payment-request:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
