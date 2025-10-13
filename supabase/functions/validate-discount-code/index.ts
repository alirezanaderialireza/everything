// supabase/functions/validate-discount-code/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { code, product_type } = await req.json();

    if (!code || !product_type) {
      throw new Error("اطلاعات ارسالی برای اعتبارسنجی کد ناقص است.");
    }

    // از کلاینت ادمین استفاده می‌کنیم تا به جدول دسترسی داشته باشیم
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY")!
    );

    // جستجو در جدول کدهای تخفیف
    const { data: discount, error } = await supabaseAdmin
      .from("discount_codes")
      .select("discount_percent, is_active")
      .eq("code", code.toUpperCase()) // کدها را به حروف بزرگ تبدیل می‌کنیم
      .eq("product_type", product_type)
      .single();

    if (error || !discount) {
      return new Response(
        JSON.stringify({ isValid: false, message: "کد تخفیف یافت نشد." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!discount.is_active) {
      return new Response(
        JSON.stringify({ isValid: false, message: "این کد تخفیf منقضی شده است." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // اگر همه چیز درست بود، درصد تخفیف را برمی‌گردانیم
    return new Response(
      JSON.stringify({
        isValid: true,
        discount_percent: discount.discount_percent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});