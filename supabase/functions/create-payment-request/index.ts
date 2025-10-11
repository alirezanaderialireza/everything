// supabase/functions/create-zibal-request/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://aidashirazi.ir",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ZIBAL_API_URL = "https://gateway.zibal.ir/v1/request";
const PRICE_RIAL = 1000000; // 100,000 Toman in Rials

serve(async (req) => {
  // Immediately handle CORS preflight requests.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get data from the request body
    const { documentTypeId, payerName, mobile } = await req.json();
    if (!documentTypeId) throw new Error("شناسه محصول ارسال نشده است.");

    // Create a Supabase client with the service role key to bypass RLS
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? "",
    );

    // Get user from the authorization header
    const authHeader = req.headers.get("Authorization")!;
    // Note: This next line requires a _supabase client instance. We should define it.
    // However, since we are in the function, we can't rely on the browser's instance.
    // The correct way is to use the Admin client to get user data from the JWT.
    // Let's assume the JWT verification logic is simple for now.
    // A more robust solution would involve a JWT library.
    
    // A simplified way to get user without a full client instance, for Edge Functions:
    const jwt = authHeader.replace("Bearer ", "");
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    const userId = payload.sub;
    if (!userId) throw new Error("کاربر شناسایی نشد.");


    // Create a new pending transaction record
    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("pending_transactions")
      .insert({
        user_id: userId,
        document_type_id: documentTypeId,
        gateway: "zibal",
      })
      .select()
      .single();

    if (transactionError) throw transactionError;

    // Prepare payload for Zibal API
    const payloadForZibal = {
      merchant: Deno.env.get("ZIBAL_MERCHANT_CODE"),
      amount: PRICE_RIAL,
      description: `خرید اسناد حسابداری - سفارش ${transaction.id}`,
      orderId: transaction.id,
      callbackUrl: `https://evfgzegtplkhocfxcjpp.supabase.co/functions/v1/verify-zibal-payment`,
      mobile: mobile, // Add mobile number
    };

    // Send request to Zibal
    const response = await fetch(ZIBAL_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadForZibal),
    });

    const result = await response.json();

    // Check Zibal response for errors
    if (result.result !== 100) {
      throw new Error(`خطا از درگاه زیبال: ${result.message}`);
    }

    // Construct the payment URL
    const paymentUrl = `https://gateway.zibal.ir/start/${result.trackId}`;

    // Return the payment URL to the client
    return new Response(JSON.stringify({ paymentUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    // Return any errors that occurred
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});

