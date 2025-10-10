import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ZIBAL_MERCHANT_CODE = Deno.env.get("ZIBAL_MERCHANT_CODE");

serve(async (req: Request) => {
  // This is needed to handle CORS preflight requests.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const trackId = url.searchParams.get("trackId");
    const success = url.searchParams.get("success");
    const documentTypeId = url.searchParams.get("type_id");
    
    // Crucially, we need to get the Authorization header to act on behalf of the user
    const authHeader = req.headers.get("Authorization")!;

    if (success !== "1") {
      // Redirect to a failure page if the payment was not successful
      return Response.redirect("https://aidashirazi.ir/documents?payment=failed", 302);
    }

    // Verify the payment with Zibal's server
    const zibalPayload = {
      merchant: ZIBAL_MERCHANT_CODE,
      trackId: trackId,
    };

    const zibalResponse = await fetch("https://gateway.zibal.ir/v1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(zibalPayload),
    });

    const zibalResult = await zibalResponse.json();

    if (zibalResult.result !== 100) {
        // Redirect to a failure page with the error message from Zibal
        return Response.redirect(`https://aidashirazi.ir/documents?payment=failed&error=${zibalResult.message}`, 302);
    }
    
    // Payment is verified. Now, create a Supabase client WITH the user's auth token
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
      
    // Get the user from the token
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        // Redirect to login if user cannot be identified
        return Response.redirect("https://aidashirazi.ir/login.html?error=user-not-found", 302);
    }

    // Insert the purchase record into the database
    const { error: dbError } = await supabase
      .from("user_purchases")
      .insert({ user_id: user.id, document_type_id: documentTypeId });

    // If there's a database error, but it's NOT a 'duplicate key' error, throw it.
    // We ignore duplicate errors because it means the user already bought this item.
    if (dbError && dbError.code !== '23505') { 
        throw dbError;
    }

    // All successful, redirect to a success page
    return Response.redirect("https://aidashirazi.ir/documents?payment=success", 302);

  } catch (error) {
    // For any other unexpected errors, redirect to a generic failure page
    return Response.redirect(`https://aidashirazi.ir/documents?payment=failed&error=${error.message}`, 302);
  }
});

