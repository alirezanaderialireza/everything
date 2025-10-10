// supabase/functions/verify-zibal-payment/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// آدرس صفحه اسناد در سایت شما
const DOCUMENTS_PAGE_URL = "https://aidashirazi.ir/documents.html";

serve(async (req) => {
  try {
    // URL را برای گرفتن پارامترها می‌خوانیم
    const url = new URL(req.url);
    const orderId = url.searchParams.get("orderId");
    const success = url.searchParams.get("success");
    const trackId = url.searchParams.get("trackId");

    // بررسی وجود پارامترهای ضروری
    if (!orderId || !success || !trackId) {
      throw new Error("اطلاعات بازگشتی از درگاه پرداخت ناقص است.");
    }

    // اگر پرداخت ناموفق بود، کاربر به صفحه اسناد بازگردانده می‌شود
    if (success.toString() !== "1") {
      // اینجا می‌توان در آینده تراکنش را در دیتابیس به عنوان ناموفق ثبت کرد
      return Response.redirect(
        `${DOCUMENTS_PAGE_URL}?payment=failed&reason=cancelled`,
        303,
      );
    }

    // ایجاد یک کلاینت سوپابیس با دسترسی کامل
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? "",
    );

    // 1. پیدا کردن تراکنش در حال انتظار با استفاده از orderId
    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("pending_transactions")
      .select("*")
      .eq("id", orderId)
      .single();

    if (transactionError || !transaction) {
      throw new Error("تراکنش در سیستم یافت نشد.");
    }

    // اگر تراکنش قبلاً کامل شده بود، جلوی پردازش مجدد را می‌گیریم
    if (transaction.status === 'completed') {
       return Response.redirect(
        `${DOCUMENTS_PAGE_URL}?payment=success&reason=already_verified`,
        303,
      );
    }

    // 2. ارسال درخواست به زیبال برای تایید نهایی پرداخت
    const verifyResponse = await fetch(
      "https://gateway.zibal.ir/v1/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: Deno.env.get("ZIBAL_MERCHANT_CODE"),
          trackId: trackId,
        }),
      },
    );

    const verifyResult = await verifyResponse.json();

    // اگر تایید پرداخت با خطا مواجه شد
    if (verifyResult.result !== 100) {
      // به‌روزرسانی وضعیت تراکنش به "failed"
      await supabaseAdmin
        .from("pending_transactions")
        .update({ status: "failed", error_message: verifyResult.message })
        .eq("id", orderId);
      throw new Error(`خطا در تایید پرداخت: ${verifyResult.message}`);
    }

    // 3. اگر پرداخت موفق بود، ثبت خرید در جدول `user_purchases`
    const { error: purchaseError } = await supabaseAdmin
      .from("user_purchases")
      .insert({
        user_id: transaction.user_id,
        document_type_id: transaction.document_type_id,
      });

    if (purchaseError) {
      // اگر در ثبت خرید نهایی خطایی رخ داد، آن را در تراکنش ثبت می‌کنیم
      await supabaseAdmin
        .from("pending_transactions")
        .update({ status: "failed", error_message: purchaseError.message })
        .eq("id", orderId);
      throw purchaseError;
    }

    // 4. به‌روزرسانی وضعیت تراکنش به "completed"
    await supabaseAdmin
      .from("pending_transactions")
      .update({ status: "completed", track_id: trackId })
      .eq("id", orderId);

    // 5. هدایت کاربر به صفحه اسناد با پیام موفقیت
    return Response.redirect(
      `${DOCUMENTS_PAGE_URL}?payment=success`,
      303,
    );
  } catch (error) {
    console.error("Verify Error:", error);
    // در صورت بروز هرگونه خطا، کاربر به صفحه اسناد با پیام خطا هدایت می‌شود
    return Response.redirect(
      `${DOCUMENTS_PAGE_URL}?payment=error&message=${
        encodeURIComponent(error.message)
      }`,
      303,
    );
  }
});

