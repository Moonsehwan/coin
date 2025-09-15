import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;

  const env = {
    has_SUPABASE_URL: !!url,
    has_SUPABASE_SERVICE_ROLE: !!key,
    has_DISCORD_WEBHOOK: !!process.env.DISCORD_WEBHOOK,
    node: process.version,
  };

  if (!url || !key) {
    return res.status(200).json({ ok: false, env, note: "missing supabase envs" });
  }

  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await sb.from("events").select("id", { head: true, count: "exact" }).limit(1);
    return res.status(200).json({ ok: true, env, tableExists: !error, tableError: error?.message || null });
  } catch (e) {
    return res.status(200).json({ ok: false, env, supabase_error: String(e) });
  }
}