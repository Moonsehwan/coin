import { createClient } from "@supabase/supabase-js";
export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) return res.status(500).json({ error: "Missing Supabase envs" });
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const minImpact = Number(req.query.minImpact ?? 0);
  const limit = Number(req.query.limit ?? 50);
  const { data, error } = await sb.from("events").select("*").gte("impact", minImpact).order("starts_at",{ ascending:false }).limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ count: data?.length || 0, events: data || [] });
}