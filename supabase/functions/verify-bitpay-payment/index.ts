// supabase/functions/verify-bitpay-payment/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const BITPAY_VERIFY_API_URL = "https://bitpay.ir/api/v2/verify";

serve(async (req) => {
  try {
    // اطلاعات از وب‌هوک بیت‌پی به صورت JSON دریافت می‌شود
    const { id, order_id } = await req.json();

    if (!id || !order_id) {
      throw new Error("اطلاعات وب‌هوک ناقص است.");
    }
    
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY")!
    );

    // ۱. پیدا کردن تراکنش
    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("pending_transactions")
      .select("*")
      .eq("id", order_id)
      .single();

    if (transactionError || !transaction) {
      throw new Error("تراکنش در سیستم یافت نشد.");
    }
    
    if (transaction.status === 'completed') {
      // اگر تراکنش قبلا کامل شده، پاسخی موفقیت‌آمیز برگردان
      return new Response("ok", { status: 200 });
    }
    
    // ۲. تایید پرداخت با سرور بیت‌پی
    const verifyResponse = await fetch(BITPAY_VERIFY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": Deno.env.get("BITPAY_API_KEY")!,
      },
      body: JSON.stringify({ id, order_id }),
    });

    const verifyResult = await verifyResponse.json();
    
    if (verifyResult.status !== 11) { // 11 یعنی پرداخت کامل
      await supabaseAdmin
        .from("pending_transactions")
        .update({ status: "failed", error_message: `BitPay status: ${verifyResult.status}` })
        .eq("id", order_id);
      throw new Error(`پرداخت توسط بیت‌پی تایید نشد. وضعیت: ${verifyResult.status}`);
    }

    // ۳. ثبت خرید
    const { error: purchaseError } = await supabaseAdmin
      .from("user_purchases")
      .insert({
        user_id: transaction.user_id,
        document_type_id: transaction.document_type_id,
      });

    if (purchaseError && purchaseError.code !== '23505') {
      await supabaseAdmin
        .from("pending_transactions")
        .update({ status: "failed", error_message: purchaseError.message })
        .eq("id", order_id);
      throw purchaseError;
    }

    // ۴. به‌روزرسانی وضعیت تراکنش
    await supabaseAdmin
      .from("pending_transactions")
      .update({ status: "completed", track_id: id.toString() })
      .eq("id", order_id);

    // ۵. ارسال پاسخ موفقیت‌آمیز به سرور بیت‌پی
    return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
    });
    
  } catch (error) {
    console.error("BitPay Webhook Error:", error);
    // در صورت خطا، یک پاسخ خطا به سرور بیت‌پی برگردان
    return new Response(JSON.stringify({ error: error.message }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
    });
  }
});