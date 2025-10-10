import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ZIBAL_MERCHANT_CODE = Deno.env.get("ZIBAL_MERCHANT_CODE");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY");

serve(async (req: Request) => {
  // This is needed if you're deploying functions from a browser.
  // This browser based deployment is not yet supported by the CLI.
  // You can remove this if you're deploying from the CLI.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Create a Supabase client with the user's auth token to identify the user
    const userSupabaseClient = createClient(
      SUPABASE_URL ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    
    // Get the user from the token
    const { data: { user }, error: userError } = await userSupabaseClient.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error("User not found.");

    const { documentTypeId } = await req.json();
    if (!documentTypeId) throw new Error("شناسه سند (documentTypeId) ارسال نشده است.");

    // Create a Supabase client with the service role key to securely insert into the database
    const serviceSupabaseClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    
    // Create a pending transaction record to track this purchase attempt
    const { data: pendingTx, error: pendingTxError } = await serviceSupabaseClient
      .from('pending_transactions')
      .insert({ user_id: user.id, document_type_id: documentTypeId })
      .select()
      .single();

    if (pendingTxError) throw pendingTxError;

    // The callback URL will now contain the unique ID of the pending transaction
    const callbackUrl = `${SUPABASE_URL}/functions/v1/verify-zibal-payment?pending_id=${pendingTx.id}`;

    const payload = {
      merchant: ZIBAL_MERCHANT_CODE,
      amount: 1000000, // 100,000 Toman in Rials
      callbackUrl: callbackUrl,
      description: `خرید مجموعه اسناد شماره ${documentTypeId} برای کاربر ${user.id}`,
    };

    // Request a payment link from Zibal
    const zibalResponse = await fetch("https://gateway.zibal.ir/v1/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    const zibalResult = await zibalResponse.json();
    if (zibalResult.result !== 100) {
      throw new Error(`خطا از درگاه پرداخت: ${zibalResult.message}`);
    }

    const paymentUrl = `https://gateway.zibal.ir/start/${zibalResult.trackId}`;

    return new Response(JSON.stringify({ paymentUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});

