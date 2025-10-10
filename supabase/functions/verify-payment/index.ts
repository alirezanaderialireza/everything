// supabase/functions/verify-zibal-payment/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const ZIBAL_VERIFY_URL = "https://gateway.zibal.ir/v1/verify";
const APP_URL = "https://aidashirazi.ir/documents.html";

// این فانکشن توسط سرور زیبال فراخوانی می‌شود و نیازی به CORS ندارد.

serve(async (req) => {
  try {
    // اطلاعات از Query Parameters در URL خوانده می‌شود
    const url = new URL(req.url);
    const success = url.searchParams.get("success");
    const trackId = url.searchParams.get("trackId");
    const orderId = url.searchParams.get("orderId");

    if (!orderId || !trackId) throw new Error("اطلاعات تراکنش ناقص است.");

    if (success !== "1") {
      return Response.redirect(`${APP_URL}?payment=failed`, 303);
    }
    
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY")!
    );

    // ۱. پیدا کردن تراکنش
    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("pending_transactions")
      .select("*")
      .eq("id", orderId)
      .single();

    if (transactionError || !transaction) {
      throw new Error(`تراکنش با شناسه ${orderId} یافت نشد.`);
    }

    // ۲. تایید پرداخت با زیبال
    const payload = {
      merchant: Deno.env.get("ZIBAL_MERCHANT_CODE"),
      trackId: Number(trackId),
    };

    const response = await fetch(ZIBAL_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    
    if (result.result !== 100) {
      if (result.result === 201) {
          return Response.redirect(`${APP_URL}?payment=success&reason=already_verified`, 303);
      }
      throw new Error(`خطا در تایید تراکنش با زیبال: ${result.message}`);
    }

    // ۳. ثبت نهایی خرید
    const { error: insertError } = await supabaseAdmin
      .from("user_purchases")
      .insert({
        user_id: transaction.user_id,
        document_type_id: transaction.document_type_id,
      });

    if (insertError && insertError.code !== '23505') { // نادیده گرفتن خطای تکراری
        throw insertError;
    }

    // ۴. هدایت کاربر با پیام موفقیت
    return Response.redirect(`${APP_URL}?payment=success`, 303);

  } catch (error) {
    console.error("Verification Error:", error.message);
    return Response.redirect(`${APP_URL}?payment=error&message=${encodeURIComponent(error.message)}`, 303);
  }
});