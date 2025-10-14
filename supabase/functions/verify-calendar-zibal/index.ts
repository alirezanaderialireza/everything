// supabase/functions/verify-calendar-zibal/index.ts (Final & Correct Code)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const APP_URL = "https://aidashirazi.ir/calendar.html"; 

serve(async (req) => {
  const redirectUrl = new URL(APP_URL);

  try {
    const url = new URL(req.url);
    const success = url.searchParams.get("success");
    const trackId = url.searchParams.get("trackId");
    const orderId = url.searchParams.get("orderId");

    if (!orderId || !trackId) throw new Error("اطلاعات بازگشتی از درگاه ناقص است.");
    if (success !== "1") {
      redirectUrl.searchParams.set("payment", "failed");
      return Response.redirect(redirectUrl.href, 303);
    }
    
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY")!
    );

    const { data: transaction } = await supabaseAdmin
      .from("pending_transactions")
      .select("*, user_id")
      .eq("id", orderId)
      .single();

    if (!transaction) throw new Error(`تراکنش با شناسه ${orderId} یافت نشد.`);

    if (transaction.status === 'completed') {
      redirectUrl.searchParams.set("payment", "success");
      redirectUrl.searchParams.set("reason", "already_verified");
      return Response.redirect(redirectUrl.href, 303);
    }

    const verifyResponse = await fetch("https://gateway.zibal.ir/v1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant: Deno.env.get("ZIBAL_MERCHANT_CODE"),
        trackId: Number(trackId),
      }),
    });
    const result = await verifyResponse.json();
    
    if (result.result !== 100 && result.result !== 201) {
      throw new Error(`خطا در تایید تراکنش با زیبال: ${result.message}`);
    }

    const { error: updateProfileError } = await supabaseAdmin
      .from("profiles")
      .update({ has_premium_calendar: true })
      .eq("id", transaction.user_id);

    if (updateProfileError) throw new Error(`خطا در فعال‌سازی تقویم: ${updateProfileError.message}`);

    await supabaseAdmin
      .from("pending_transactions")
      .update({ status: "completed", track_id: trackId })
      .eq("id", orderId);

    redirectUrl.searchParams.set("payment", "success");
    return Response.redirect(redirectUrl.href, 303);

  } catch (error) {
    console.error("Zibal Calendar Verification Error:", error.message);
    redirectUrl.searchParams.set("payment", "error");
    redirectUrl.searchParams.set("message", encodeURIComponent(error.message));
    return Response.redirect(redirectUrl.href, 303);
  }
});