// supabase/functions/verify-zibal-payment/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const ZIBAL_VERIFY_URL = "https://gateway.zibal.ir/v1/verify";
// آدرس صفحه اسناد در سایت شما برای بازگشت کاربر
const APP_URL = "https://aidashirazi.ir/documents.html"; 

serve(async (req) => {
  const redirectUrl = new URL(APP_URL);

  try {
    // اطلاعات از Query Parameters در URL خوانده می‌شود
    const url = new URL(req.url);
    const success = url.searchParams.get("success");
    const trackId = url.searchParams.get("trackId");
    const orderId = url.searchParams.get("orderId");

    // ۱. بررسی اولیه پارامترهای بازگشتی از درگاه
    if (!orderId || !trackId) {
      throw new Error("اطلاعات بازگشتی از درگاه پرداخت ناقص است.");
    }

    if (success !== "1") {
      redirectUrl.searchParams.set("payment", "failed");
      return Response.redirect(redirectUrl.href, 303);
    }
    
    // ۲. ایجاد کلاینت ادمین برای ارتباط با دیتابیس
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY")!
    );

    // ۳. پیدا کردن تراکنش در جدول pending_transactions
    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("pending_transactions")
      .select("*")
      .eq("id", orderId)
      .single();

    if (transactionError || !transaction) {
      throw new Error(`تراکنش با شناسه سفارش ${orderId} یافت نشد.`);
    }

    // ۴. بررسی برای جلوگیری از پردازش مجدد (Idempotency)
    if (transaction.status === 'completed') {
      redirectUrl.searchParams.set("payment", "success");
      redirectUrl.searchParams.set("reason", "already_verified");
      return Response.redirect(redirectUrl.href, 303);
    }

    // ۵. تایید نهایی پرداخت با سرور زیبال (مهم‌ترین مرحله امنیتی)
    const verifyResponse = await fetch(ZIBAL_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant: Deno.env.get("ZIBAL_MERCHANT_CODE"),
        trackId: Number(trackId),
      }),
    });

    const result = await verifyResponse.json();
    
    // ۶. بررسی پاسخ سرور زیبال
    if (result.result !== 100) {
      // اگر تراکنش قبلا تایید شده بود، آن را موفق در نظر بگیر
      if (result.result === 201) {
          redirectUrl.searchParams.set("payment", "success");
          redirectUrl.searchParams.set("reason", "already_verified");
          return Response.redirect(redirectUrl.href, 303);
      }
      // در غیر این صورت، تراکنش را ناموفق ثبت کن
      await supabaseAdmin
        .from("pending_transactions")
        .update({ status: "failed", error_message: `Zibal: ${result.message}` })
        .eq("id", orderId);
      throw new Error(`خطا در تایید تراکنش با زیبال: ${result.message}`);
    }

    // ۷. ثبت نهایی خرید در جدول user_purchases
    const { error: insertError } = await supabaseAdmin
      .from("user_purchases")
      .insert({
        user_id: transaction.user_id,
        document_type_id: transaction.document_type_id,
      });

    // اگر خرید تکراری بود، خطا را نادیده بگیر، در غیر این صورت خطا را ثبت کن
    if (insertError && insertError.code !== '23505') {
        await supabaseAdmin
          .from("pending_transactions")
          .update({ status: "failed", error_message: insertError.message })
          .eq("id", orderId);
        throw insertError;
    }

    // ۸. به‌روزرسانی وضعیت نهایی تراکنش به 'completed'
    await supabaseAdmin
      .from("pending_transactions")
      .update({ status: "completed", track_id: trackId })
      .eq("id", orderId);

    // ۹. هدایت کاربر به سایت با پیام موفقیت
    redirectUrl.searchParams.set("payment", "success");
    return Response.redirect(redirectUrl.href, 303);

  } catch (error) {
    console.error("Zibal Verification Error:", error.message);
    redirectUrl.searchParams.set("payment", "error");
    redirectUrl.searchParams.set("message", encodeURIComponent(error.message));
    return Response.redirect(redirectUrl.href, 303);
  }
});