// supabase/functions/verify-bitpay-payment/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const BITPAY_VERIFY_API_URL = "https://bitpay.ir/api/v2/verify";
const DOCUMENTS_PAGE_URL = "https://aidashirazi.ir/documents.html";

serve(async (req) => {
  try {
    const { id, order_id } = await req.json();

    if (!id || !order_id) {
      throw new Error("اطلاعات بازگشتی از درگاه پرداخت ناقص است.");
    }
    
    // ایجاد یک کلاینت سوپابیس با دسترسی کامل
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? "",
    );

    // 1. پیدا کردن تراکنش در حال انتظار
    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("pending_transactions")
      .select("*")
      .eq("id", order_id)
      .single();

    if (transactionError || !transaction) {
      throw new Error("تراکنش در سیستم یافت نشد.");
    }
    
     if (transaction.status === 'completed') {
       return Response.redirect(`${DOCUMENTS_PAGE_URL}?payment=success&reason=already_verified`, 303);
    }
    
    // 2. تایید پرداخت با سرور بیت‌پی
    const verifyResponse = await fetch(BITPAY_VERIFY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": Deno.env.get("BITPAY_API_KEY"),
        },
        body: JSON.stringify({ id, order_id }),
      },
    );

    const verifyResult = await verifyResponse.json();
    
    // status 11 means payment is complete
    if (verifyResult.status !== 11) {
      await supabaseAdmin
        .from("pending_transactions")
        .update({ status: "failed", error_message: `BitPay status: ${verifyResult.status}` })
        .eq("id", order_id);
      throw new Error(`پرداخت توسط بیت‌پی تایید نشد. وضعیت: ${verifyResult.status}`);
    }

    // 3. ثبت خرید در جدول user_purchases
    const { error: purchaseError } = await supabaseAdmin
      .from("user_purchases")
      .insert({
        user_id: transaction.user_id,
        document_type_id: transaction.document_type_id,
      });

    if (purchaseError) {
      await supabaseAdmin
        .from("pending_transactions")
        .update({ status: "failed", error_message: purchaseError.message })
        .eq("id", order_id);
      throw purchaseError;
    }

    // 4. به‌روزرسانی وضعیت تراکنش به "completed"
    await supabaseAdmin
      .from("pending_transactions")
      .update({ status: "completed", track_id: id.toString() }) // Use BitPay's ID as track_id
      .eq("id", order_id);

    // 5. هدایت کاربر به صفحه اسناد
    return Response.redirect(`${DOCUMENTS_PAGE_URL}?payment=success`, 303);
    
  } catch (error) {
    console.error("BitPay Verify Error:", error);
    return Response.redirect(
      `${DOCUMENTS_PAGE_URL}?payment=error&message=${encodeURIComponent(error.message)}`,
      303,
    );
  }
});
