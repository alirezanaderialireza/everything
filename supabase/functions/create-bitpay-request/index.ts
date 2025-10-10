// supabase/functions/create-bitpay-request/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const BITPAY_API_URL = "https://bitpay.ir/api/v2/invoice";
const PRICE_TOMAN = 100000; // قیمت ثابت محصول به تومان

serve(async (req) => {
  // پاسخ به درخواست پیش‌بررسی CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { documentTypeId } = await req.json();
    if (!documentTypeId) throw new Error("شناسه محصول ارسال نشده است.");

    // ایجاد یک کلاینت سوپابیس با دسترسی کامل
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? "",
    );

    // گرفتن اطلاعات کاربر از توکن احراز هویت
    const authHeader = req.headers.get("Authorization")!;
    const { data: { user } } = await _supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!user) throw new Error("کاربر شناسایی نشد.");

    // 1. ثبت یک تراکنش در حال انتظار
    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("pending_transactions")
      .insert({
        user_id: user.id,
        document_type_id: documentTypeId,
        gateway: "bitpay", // مشخص کردن درگاه
      })
      .select()
      .single();

    if (transactionError) throw transactionError;

    // 2. آماده‌سازی درخواست برای بیت‌پی
    const payload = {
      price: PRICE_TOMAN,
      description: `خرید اسناد حسابداری - سفارش ${transaction.id}`,
      payerName: user.email, // نام پرداخت‌کننده (اختیاری)
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
      body: JSON.stringify(payload),
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
