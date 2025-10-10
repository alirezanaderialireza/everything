// supabase/functions/_shared/cors.ts

// هدرهای لازم برای مکانیزم امنیتی CORS مرورگرها
export const corsHeaders = {
  "Access-Control-Allow-Origin": "https://aidashirazi.ir", // فقط به این دامنه اجازه می‌دهیم
  "Access-Control-Allow-Methods": "POST, OPTIONS", // فقط این متدها مجاز هستند
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

