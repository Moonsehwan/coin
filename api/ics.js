import { createClient } from "@supabase/supabase-js";
import { createEvents } from "ics";

export default async function handler(req, res){
  try {
    const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE;
    if(!url || !key){ res.status(500).send("Missing envs"); return; }
    const sb=createClient(url,key,{auth:{persistSession:false}});

    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const minImpact = Number(searchParams.get("minImpact")||0);
    const limit = Math.min(Number(searchParams.get("limit")||200), 500);

    let q=sb.from("events")
      .select("title,url,starts_at,impact,category,symbols,polarity,created_at")
      .order("starts_at", { ascending: false })
      .limit(limit);
    if(minImpact>0) q=q.gte("impact",minImpact);

    const { data, error } = await q;
    if(error) return res.status(500).send(error.message);

    const events = (data||[]).map(row => {
      const dt = row.starts_at ? new Date(row.starts_at) : new Date(row.created_at);
      return {
        title: `[${row.category ?? "event"} ${row.impact ?? ""}] ${row.title}`.slice(0, 60),
        start: [dt.getUTCFullYear(), dt.getUTCMonth()+1, dt.getUTCDate(), dt.getUTCHours(), dt.getUTCMinutes()],
        startInputType: "utc",
        duration: { minutes: 15 },
        url: row.url || undefined,
        description: `${row.title}\n${row.url || ""}\nSymbols: ${(row.symbols||[]).join(", ")}\nImpact: ${row.impact} Polarity: ${row.polarity}`,
        status: "CONFIRMED",
      };
    });

    const { value, error: icsErr } = createEvents(events);
    if(icsErr) return res.status(500).send(String(icsErr));

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"coin-calendar.ics\"");
    return res.status(200).send(value);
  } catch(e){
    return res.status(500).send(String(e));
  }
}