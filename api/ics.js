import { createClient } from "@supabase/supabase-js";
import { createEvents } from "ics";
export default async function handler(req, res) {
  const minImpact = Number(req.query.minImpact ?? process.env.MIN_IMPACT_ICS ?? 6);
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) return res.status(500).send("ERR env");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const now = new Date(), until = new Date(now.getTime() + 1000*60*60*24*30);
  const { data, error } = await sb.from("events").select("*")
    .gte("impact", minImpact).gte("starts_at", now.toISOString()).lte("starts_at", until.toISOString())
    .order("starts_at",{ ascending:true }).limit(500);
  if (error) return res.status(500).send("ERR query");
  const events = (data||[]).map(e => {
    const d = e.starts_at ? new Date(e.starts_at) : new Date();
    return {
      title: `[${e.category ?? "event"}] ${e.title}`.slice(0,70),
      start: [d.getFullYear(), d.getMonth()+1, d.getDate(), d.getHours(), d.getMinutes()],
      startInputType:"local", startOutputType:"local", duration:{ hours:1 },
      description: `${e.description || ""}\n${e.url || ""}\nImpact: ${e.impact} (${e.polarity})`,
      url: e.url || undefined, calName:"Coin Alerts", productId:"coin-calendar-mvp", status:"CONFIRMED"
    };
  });
  createEvents(events, (err, text) => {
    if (err) return res.status(500).send("ERR ics");
    res.setHeader("Content-Type","text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition",'attachment; filename="coin_alerts.ics"');
    res.status(200).send(text);
  });
}