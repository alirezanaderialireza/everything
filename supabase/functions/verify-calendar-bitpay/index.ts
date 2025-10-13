// supabase/functions/verify-calendar-bitpay/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// آدرس بازگشتی را به صفحه تقویم تغییر می‌دهیم
const APP_URL = "https://aidashirazi.ir/calendar.html"; 

serve(async (req) => {
  const redirectUrl = new URL(APP_URL);

  try {
    const url = new URL(req.url);
    const trans_id = url.searchParams.get("trans_id");
    const id_get = url.searchParams.get("id_get");
    const factorId = url.searchParams.get("factorId"); // بیت‌پی factorId را برمی‌گرداند

    if (!trans_id || !id_get || !factorId) {
      throw new Error("اطلاعات بازگشتی از بیت‌پی ناقص است.");
    }
    
    // ۱. ارسال درخواست تأیید نهایی به بیت‌پی
    const params = new URLSearchParams();
    params.append('api', Deno.env.get("BITPAY_API_TOKEN")!);
    params.append('trans_id', trans_id);
    params.append('id_get', id_get);

    const verifyResponse = await fetch("https://bitpay.ir/payment/gateway-result-second", {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    const verifyText = await verifyResponse.text();
    const status = parseInt(verifyText, 10);

    // ۲. بررسی وضعیت بازگشتی از بیت‌پی
    if (status !== 1 && status !== 11) { // 1=موفق, 11=قبلا تایید شده
      throw new Error(`تراکنش توسط بیت‌پی تایید نشد. وضعیت: ${status}`);
    }
    
    // ۳. ایجاد کلاینت ادمین
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY")!
    );

    // ۴. پیدا کردن تراکنش با استفاده از factorId
    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("pending_transactions")
      .select("*")
      .eq("id", factorId) // در بیت‌پی از factorId استفاده می‌کنیم که همان orderId ماست
      .eq("product_type", "calendar")
      .single();

    if (transactionError || !transaction) {
      throw new Error(`تراکنش تقوim با شناسه ${factorId} یافت نشد.`);
    }

    if (transaction.status === 'completed') {
      redirectUrl.searchParams.set("payment", "success");
      redirectUrl.searchParams.set("reason", "already_verified");
      return Response.redirect(redirectUrl.href, 303);
    }
    
    // ۵. **فعال‌سازی دسترسی برای کاربر**
    const { error: updateProfileError } = await supabaseAdmin
      .from("profiles")
      .update({ has_premium_calendar: true }) // فعال‌سازی دسترسی
      .eq("id", transaction.user_id);

    if (updateProfileError) {
        throw new Error(`خطا در فعال‌سازی تقویم: ${updateProfileError.message}`);
    }

    // ۶. نهایی کردن وضعیت تراکنش
    await supabaseAdmin
      .from("pending_transactions")
      .update({ status: "completed", track_id: trans_id }) // track_id را از بیت‌پی ذخیره می‌کنیم
      .eq("id", factorId);

    // ۷. هدایت کاربر با پیام موفقیت
    redirectUrl.searchParams.set("payment", "success");
    return Response.redirect(redirectUrl.href, 303);

  } catch (error) {
    console.error("BitPay Calendar Verification Error:", error.message);
    redirectUrl.searchParams.set("payment", "error");
    redirectUrl.searchParams.set("message", encodeURIComponent(error.message));
    return Response.redirect(redirectUrl.href, 303);
  }
});