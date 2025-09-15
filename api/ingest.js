import { createClient } from "@supabase/supabase-js";
import { hashObject } from "../lib/util.js";
import { scoreEvent } from "../lib/scoring.js";
import { fetchUpbitNotices } from "../lib/sources/upbit.js";

async function sendDiscord(evt) {
  const webhook = process.env.DISCORD_WEBHOOK; if (!webhook) return;
  const color = evt.polarity === "bull" ? 0x00cc66 : evt.polarity === "bear" ? 0xcc0033 : 0x5865f2;
  const fields = [];
  if (evt.symbols?.length) fields.push({ name:"Symbols", value:evt.symbols.join(", "), inline:true });
  if (evt.category) fields.push({ name:"Category", value:evt.category, inline:true });
  fields.push({ name:"Impact", value:String(evt.impact), inline:true });
  const payload = { embeds:[{ title: evt.title?.slice(0,240), url: evt.url, color, fields, timestamp: new Date().toISOString(), footer: { text:`${evt.source} ? alert?${process.env.MIN_IMPACT_ALERT||7}` } }] };
  try { await fetch(webhook, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) }); } catch {}
}

export default async function handler(req, res) {
  const dryRun = req.method === "POST" ? Boolean(req.body?.dryRun) : false;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) return res.status(500).json({ error:"Missing Supabase envs" });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const minAlert = Number(process.env.MIN_IMPACT_ALERT || 7);
  let sources = [];
  try { sources.push(...await fetchUpbitNotices()); } catch {}

  const inserted = [];
  for (const raw of sources) {
    const { impact, polarity, confidence } = scoreEvent({ category: raw.category });
    const evt = { ...raw, impact, polarity, confidence };
    const dedupe_hash = hashObject({ source: evt.source, source_id: evt.source_id || evt.url });

    const { data: exist } = await sb.from("events").select("id").eq("dedupe_hash", dedupe_hash).maybeSingle();
    if (exist) continue;

    if (!dryRun) {
      const { error } = await sb.from("events").insert({
        source: evt.source, source_id: evt.source_id, title: evt.title, description: evt.description,
        url: evt.url, symbols: evt.symbols||[], category: evt.category, polarity: evt.polarity,
        impact: evt.impact, confidence: evt.confidence, starts_at: evt.starts_at, ends_at: null, dedupe_hash
      });
      if (error) continue;
    }
    inserted.push(evt);
    if (evt.impact >= minAlert && !dryRun) { try { await sendDiscord(evt); } catch {} }
  }
  res.status(200).json({ inserted: inserted.length, dryRun, samples: inserted.slice(0,5) });
}