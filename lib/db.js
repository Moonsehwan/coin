import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE;

if (!url || !serviceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE");
}

// NOTE: Service role key는 서버사이드에서만 사용. Vercel serverless에서는 환경변수 비공개라 안전.
export const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

