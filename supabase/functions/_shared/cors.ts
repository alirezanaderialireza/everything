// These are CORS headers. They allow the browser to talk to your Supabase Edge Function.
// For more details, see: https://supabase.com/docs/guides/functions/cors
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // We use '*' for now to ensure it works, then we can restrict it.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};