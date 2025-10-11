// supabase/functions/verify-bitpay-payment/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req) => {
  try {
    const event = await req.json();
    
    // فقط رویدادهای مربوط به پرداخت موفق را پردازش کن
    if (event.event.name === "invoice_completed") {
      const invoice = event.data;
      const orderId = invoice.orderId;

      const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!);

      // پیدا کردن تراکنش در حال انتظار
      const { data: transaction } = await supabaseAdmin.from("pending_transactions")
        .select("*").eq("id", orderId).single();

      if (transaction) {
        // ثبت نهایی خرید
        await supabaseAdmin.from("user_purchases").insert({
          user_id: transaction.user_id,
          document_type_id: transaction.document_type_id,
        });
      }
    }
    
    // همیشه به وب‌هوک پاسخ 200 بده تا دوباره ارسال نشود
    return new Response("Webhook processed.", { status: 200 });

  } catch (error) {
    console.error("BitPay Webhook Error:", error.message);
    return new Response(`Webhook Error: ${error.message}`, { status: 400 });
  }
});