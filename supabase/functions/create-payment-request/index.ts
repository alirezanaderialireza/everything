// supabase/functions/create-payment-request/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
// وارد کردن هدرهای CORS از فایل مشترک
import { corsHeaders } from "../_shared/cors.ts";

const PRICE_Toman = 100000;

serve(async (req) => {
  // لاگ اولیه برای اطمینان از فراخوانی تابع
  console.log("--- create-payment-request function invoked ---");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- لاگ‌های دیباگ برای بررسی مقادیر Secrets ---
    console.log("ZIBAL_MERCHANT_CODE is set:", !!Deno.env.get("ZIBAL_MERCHANT_CODE"));
    console.log("BITPAY_API_TOKEN is set:", !!Deno.env.get("BITPAY_API_TOKEN"));
    console.log("SERVICE_ROLE_KEY is set:", !!Deno.env.get("SERVICE_ROLE_KEY"));
    // --------------------------------------------------

    const { documentTypeId, gateway, userInfo } = await req.json();
    
    // لاگ برای دیدن اطلاعات دریافتی از فرانت‌اند
    console.log("Received data from client:", { documentTypeId, gateway, userInfo });

    if (!documentTypeId || !gateway || !userInfo) {
      throw new Error("اطلاعات ارسالی از کلاینت ناقص است.");
    }
    
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization")!;
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("کاربر شناسایی نشد. توکن نامعتبر است.");
    const userId = user.id;

    console.log(`User ${userId} identified successfully.`);

    // آپدیت پروفایل کاربر
    await supabaseAdmin.from("profiles").update({
      full_name: userInfo.fullName,
      mobile: userInfo.mobile
    }).eq('id', userId);

    console.log(`Profile for user ${userId} updated.`);

    // ایجاد تراکنش در حال انتظار
    const { data: transaction } = await supabaseAdmin.from("pending_transactions").insert({
      user_id: userId,
      document_type_id: documentTypeId,
      gateway: gateway,
    }).select().single();

    if (!transaction) throw new Error("خطا در ثبت تراکنش اولیه در دیتابیس.");

    console.log(`Pending transaction ${transaction.id} created.`);

    let paymentUrl = "";

    // انتخاب درگاه و ایجاد لینک پرداخت
    if (gateway === 'zibal') {
      console.log("Initiating Zibal payment...");
      const zibalResponse = await fetch("https://gateway.zibal.ir/v1/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: Deno.env.get("ZIBAL_MERCHANT_CODE"),
          amount: PRICE_Toman * 10,
          description: `سفارش ${transaction.id}`,
          orderId: transaction.id,
          callbackUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/verify-zibal-payment`,
          mobile: userInfo.mobile,
        }),
      });
      const zibalData = await zibalResponse.json();
      if (zibalData.result !== 100) throw new Error(`Zibal Error: ${zibalData.message}`);
      paymentUrl = `https://gateway.zibal.ir/start/${zibalData.trackId}`;
      console.log("Zibal payment URL created.");

    } else if (gateway === 'bitpay') {
      console.log("Initiating BitPay payment...");
      // **توجه:** این بخش مربوط به bitpay.ir است.
      const bitpayResponse = await fetch("https://bitpay.ir/api/v2/invoice", {
          method: "POST",
          headers: {
              "Content-Type": "application/json",
              "X-API-KEY": Deno.env.get("BITPAY_API_TOKEN")!,
          },
          body: JSON.stringify({
              amount: PRICE_Toman,
              payerName: userInfo.fullName,
              payerEmail: user.email,
              payerMobile: userInfo.mobile,
              order_id: transaction.id,
              webhook_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/verify-bitpay-payment`,
              redirect_url: `${Deno.env.get("SITE_URL")}/documents.html`
          })
      });
      const bitpayData = await bitpayResponse.json();
      if (!bitpayData || bitpayData.status !== 1) throw new Error(`BitPay Error: ${bitpayData.errorMessage || 'Unknown error'}`);
      paymentUrl = `https://bitpay.ir/invoice-payment/${bitpayData.id}`;
      console.log("BitPay payment URL created.");
    }

    return new Response(JSON.stringify({ paymentUrl }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Error in create-payment-request:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});