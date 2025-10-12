// supabase/functions/verify-bitpay-payment/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SITE_URL = Deno.env.get("SITE_URL") || "https://aidashirazi.ir";

serve(async (req) => {
  const redirectUrl = new URL("/documents.html", SITE_URL);
  
  try {
    const url = new URL(req.url);
    const trans_id = url.searchParams.get("trans_id");
    const id_get = url.searchParams.get("id_get");

    if (!trans_id || !id_get) {
      throw new Error("اطلاعات بازگشتی از بیت‌پی ناقص است.");
    }
    
    // ارسال درخواست تأیید نهایی به بیت‌پی
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

    // طبق مستندات، status=1 یعنی موفق و status=11 یعنی قبلا تایید شده
    if (status !== 1 && status !== 11) {
      throw new Error(`تراکنش توسط بیت‌پی تایید نشد. وضعیت: ${status}`);
    }

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!);
    
    // برای پیدا کردن تراکنش، باید factorId را از دیتابیس بخوانیم.
    // این بخش نیاز به اصلاح منطق دارد. در مستندات راهی برای لینک مستقیم id_get به factorId نیست.
    // فعلا فرض می‌کنیم که تأیید موفقیت‌آمیز کافی است.
    
    // **مهم:** شما باید یک منطق برای پیدا کردن کاربر و سندی که خریده پیاده‌سازی کنید.
    // برای مثال می‌توانید آخرین تراکنش در حال انتظار آن کاربر را پیدا کنید.
    
    redirectUrl.searchParams.set("payment", "success");
    return Response.redirect(redirectUrl.href, 303);

  } catch (error) {
    console.error("BitPay Verification Error:", error.message);
    redirectUrl.searchParams.set("payment", "error");
    redirectUrl.searchParams.set("message", encodeURIComponent(error.message));
    return Response.redirect(redirectUrl.href, 303);
  }
});