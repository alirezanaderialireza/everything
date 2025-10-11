// supabase/functions/create-bitpay-request/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://aidashirazi.ir",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BITPAY_API_URL = "https://bitpay.ir/api/v2/invoice";
const PRICE_TOMAN = 100000; // قیمت ثابت محصول به تومان

serve(async (req) => {
  // پاسخ به درخواست پیش‌بررسی CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { documentTypeId, payerName, mobile } = await req.json();
    if (!documentTypeId) throw new Error("شناسه محصول ارسال نشده است.");

    // ایجاد یک کلاینت سوپابیس با دسترسی کامل
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? "",
    );

    // گرفتن اطلاعات کاربر از توکن احراز هویت
    const authHeader = req.headers.get("Authorization")!;
    const jwt = authHeader.replace("Bearer ", "");
    const payloadJwt = JSON.parse(atob(jwt.split('.')[1]));
    const userId = payloadJwt.sub;
    if (!userId) throw new Error("کاربر شناسایی نشد.");

    // 1. ثبت یک تراکنش در حال انتظار
    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("pending_transactions")
      .insert({
        user_id: userId,
        document_type_id: documentTypeId,
        gateway: "bitpay", // مشخص کردن درگاه
      })
      .select()
      .single();

    if (transactionError) throw transactionError;

    // 2. آماده‌سازی درخواست برای بیت‌پی
    const payloadForBitpay = {
      price: PRICE_TOMAN,
      description: `خرید اسناد حسابداری - سفارش ${transaction.id}`,
      payerName: payerName, // استفاده از نام دریافت شده از فرم
      phone: mobile,      // استفاده از شماره موبایل دریافت شده از فرم
      order_id: transaction.id, // ارسال شناسه تراکنش ما به بیت‌پی
      callback: `https://evfgzegtplkhocfxcjpp.supabase.co/functions/v1/verify-bitpay-payment`, // آدرس بازگشت
    };

    // 3. ارسال درخواست به بیت‌پی برای ایجاد فاکتور
    const response = await fetch(BITPAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": Deno.env.get("BITPAY_API_KEY"), // استفاده از کلید محرمانه
      },
      body: JSON.stringify(payloadForBitpay),
    });

    const result = await response.json();

    if (response.status !== 200) {
      throw new Error(result.errorMessage || "خطا در ایجاد فاکتور بیت‌پی");
    }
    
    // 4. ارسال لینک پرداخت به کاربر
    const paymentUrl = `https://bitpay.ir/invoice-payment/${result.id}`;

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

