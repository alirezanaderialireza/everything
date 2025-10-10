import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ZIBAL_MERCHANT_CODE = Deno.env.get("ZIBAL_MERCHANT_CODE");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY");

serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const trackId = url.searchParams.get("trackId");
    const success = url.searchParams.get("success");
    const pendingId = url.searchParams.get("pending_id");

    // If Zibal redirect indicates failure, redirect the user immediately
    if (success !== "1") {
      return Response.redirect("https://aidashirazi.ir/documents?payment=failed&reason=cancelled", 302);
    }
    if (!trackId || !pendingId) {
      throw new Error("اطلاعات بازگشتی از درگاه ناقص است.");
    }
    
    // Create a Supabase client with the service role key to securely access the database
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    // 1. Verify the payment with Zibal's server
    const zibalPayload = { merchant: ZIBAL_MERCHANT_CODE, trackId };
    const zibalResponse = await fetch("https://gateway.zibal.ir/v1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(zibalPayload),
    });
    const zibalResult = await zibalResponse.json();
    if (zibalResult.result !== 100) {
      return Response.redirect(`https://aidashirazi.ir/documents?payment=failed&reason=${zibalResult.message}`, 302);
    }
    
    // 2. Retrieve the pending transaction details from your database using the unique ID
    const { data: pendingTx, error: pendingTxError } = await supabase
      .from('pending_transactions')
      .select('user_id, document_type_id')
      .eq('id', pendingId)
      .single();

    if (pendingTxError || !pendingTx) {
      throw new Error(`تراکنش در حال انتظار با شناسه ${pendingId} یافت نشد.`);
    }

    // 3. Insert the successful purchase into the final user_purchases table
    const { error: dbError } = await supabase
      .from("user_purchases")
      .insert({ user_id: pendingTx.user_id, document_type_id: pendingTx.document_type_id });

    // We can safely ignore 'duplicate key' errors, but we should handle other potential errors.
    if (dbError && dbError.code !== '23505') { 
      throw dbError;
    }

    // 4. (Optional but recommended) Clean up by deleting the pending transaction record
    await supabase.from('pending_transactions').delete().eq('id', pendingId);

    // 5. All successful, redirect the user's browser to a success page
    return Response.redirect("https://aidashirazi.ir/documents?payment=success", 302);

  } catch (error) {
    // For any other unexpected errors, redirect the user to a generic failure page
    return Response.redirect(`https://aidashirazi.ir/documents?payment=failed&reason=${error.message}`, 302);
  }
});

