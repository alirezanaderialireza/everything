// supabase/functions/create-payment-request/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://aidashirazi.ir",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRICE_Toman = 100000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { documentTypeId, gateway, userInfo } = await req.json();
    if (!documentTypeId || !gateway || !userInfo) {
      throw new Error("اطلاعات ارسالی ناقص است.");
    }
    
    // --- شناسایی امن کاربر (بخش اصلاح شده قبلی) ---
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization")!;
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("کاربر شناسایی نشد.");
    const userId = user.id;

    // --- آپدیت پروفایل کاربر با اطلاعات جدید ---
    await supabaseAdmin.from("profiles").update({
      full_name: userInfo.fullName,
      mobile: userInfo.mobile
    }).eq('id', userId);

    // --- ایجاد تراکنش در حال انتظار ---
    const { data: transaction } = await supabaseAdmin.from("pending_transactions").insert({
      user_id: userId,
      document_type_id: documentTypeId,
      gateway: gateway,
    }).select().single();
    if (!transaction) throw new Error("خطا در ثبت تراکنش اولیه.");

    let paymentUrl = "";

    // --- انتخاب درگاه و ایجاد لینک پرداخت ---
    if (gateway === 'zibal') {
      const zibalResponse = await fetch("https://gateway.zibal.ir/v1/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: Deno.env.get("ZIBAL_MERCHANT_CODE"),
          amount: PRICE_Toman * 10, // تبدیل به ریال
          description: `سفارش ${transaction.id}`,
          orderId: transaction.id,
          callbackUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/verify-zibal-payment`,
          mobile: userInfo.mobile,
        }),
      });
      const zibalData = await zibalResponse.json();
      if (zibalData.result !== 100) throw new Error(zibalData.message);
      paymentUrl = `https://gateway.zibal.ir/start/${zibalData.trackId}`;

    } else if (gateway === 'bitpay') {
      // **نکته:** برای بیت‌پی باید توکن دسترسی خود را بسازید
      const BITPAY_TOKEN = Deno.env.get("BITPAY_API_TOKEN"); 
      const bitpayResponse = await fetch("https://bitpay.com/invoices", {
          method: "POST",
          headers: {
              "Content-Type": "application/json",
              "X-Accept-Version": "2.0.0",
              "Authorization": `Bearer ${BITPAY_TOKEN}`
          },
          body: JSON.stringify({
              price: PRICE_Toman / 50000, // تبدیل قیمت به دلار (مثال)
              currency: "USD",
              orderId: transaction.id,
              notificationURL: `${Deno.env.get("SUPABASE_URL")}/functions/v1/verify-bitpay-payment`,
              redirectURL: `${Deno.env.get("SITE_URL")}/documents.html?payment=success`,
              buyer: {
                  name: userInfo.fullName,
                  email: user.email
              }
          })
      });
      const bitpayData = await bitpayResponse.json();
      if (bitpayData.error) throw new Error(bitpayData.error);
      paymentUrl = bitpayData.data.url;
    }

    return new Response(JSON.stringify({ paymentUrl }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});