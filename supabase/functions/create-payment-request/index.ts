// supabase/functions/create-zibal-request/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// هدرهای CORS را به صورت کامل و مستقیم در همین فایل تعریف می‌کنیم
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://aidashirazi.ir",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// تابع اصلی که با هر درخواست اجرا می‌شود
serve(async (req) => {
  // این بخش برای مدیریت درخواست پیش‌بررسی (preflight) مرورگر ضروری است
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ایجاد یک کلاینت سوپابیس با دسترسی کامل (service_role)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? "",
    );

    // گرفتن اطلاعات محصول از درخواست کاربر
    const { documentTypeId } = await req.json();
    if (!documentTypeId) {
      throw new Error("شناسه محصول (documentTypeId) ارسال نشده است.");
    }

    // 1. بررسی هویت کاربر از طریق هدر Authorization
    const authHeader = req.headers.get("Authorization")!;
    const { data: { user } } = await supabaseAdmin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!user) {
      throw new Error("کاربر شناسایی نشد. لطفاً ابتدا وارد حساب خود شوید.");
    }

    // 2. ایجاد یک رکورد تراکنش در جدول جدید `pending_transactions`
    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("pending_transactions")
      .insert({
        user_id: user.id,
        document_type_id: documentTypeId,
        amount: 1000000, // قیمت به ریال (۱۰۰,۰۰۰ تومان)
      })
      .select()
      .single();

    if (transactionError) {
      // اگر خطا به دلیل خرید تکراری باشد، پیام مناسب نمایش داده می‌شود
      if (transactionError.code === "23505") {
        return new Response(
          JSON.stringify({ error: "شما قبلاً این مجموعه را خریداری کرده‌اید." }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 409, // Conflict
          },
        );
      }
      throw transactionError;
    }

    // 3. ارسال درخواست به زیبال برای ایجاد لینک پرداخت
    const zibalResponse = await fetch(
      "https://gateway.zibal.ir/v1/request",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: Deno.env.get("ZIBAL_MERCHANT_CODE"),
          amount: transaction.amount,
          callbackUrl: `${
            Deno.env.get("SUPABASE_URL")
          }/functions/v1/verify-zibal-payment`,
          orderId: transaction.id, // استفاده از شناسه تراکنش به عنوان شماره سفارش
          description: `خرید سند شماره ${documentTypeId}`,
        }),
      },
    );

    const zibalResult = await zibalResponse.json();

    if (zibalResult.result !== 100) {
      throw new Error(`خطا از درگاه پرداخت: ${zibalResult.message}`);
    }

    // 4. ارسال لینک پرداخت به کاربر
    const paymentUrl = `https://gateway.zibal.ir/start/${zibalResult.trackId}`;

    return new Response(JSON.stringify({ paymentUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    // مدیریت خطاها و ارسال پاسخ مناسب
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});

