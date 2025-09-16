// api/ingest.js (추가/갱신용 간단 합본)
import { fetchUpbitNotices } from "../lib/sources/upbit.js";
import { fetchUnlocks } from "../lib/sources/unlocks.js";
import { supabase } from "../lib/db.js";

async function sendDiscord(msg){
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!hook) return;
  await fetch(hook, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ content: msg }) });
}

export default async function handler(req, res){
  try {
    const body   = req.method==="POST" ? req.body : {};
    const dryRun = Boolean(body?.dryRun);

    const a = await fetchUpbitNotices().catch(()=>[]);
    const b = await fetchUnlocks().catch(()=>[]);
    const events = [...a, ...b];

    let inserted = 0, newOnes = [];
    if (!dryRun && events.length){
      const { data, error } = await supabase
        .from("events")
        .upsert(events, { onConflict: "source,source_id", ignoreDuplicates: true })
        .select();
      if (error) throw error;
      newOnes = data || [];
      inserted = newOnes.length;
    }

    // 알림(impact ≥ 8)
    for (const ev of newOnes){
      if ((ev.impact ?? 0) >= 8){
        await sendDiscord(`**[${ev.source}] ${ev.title}**\n${ev.url||""}\ncat=${ev.category} impact=${ev.impact}`);
      }
    }

    return res.status(200).json({ ok:true, dryRun, fetched: events.length, inserted, samples: events.slice(0,5) });
  } catch (e) {
    return res.status(200).json({ ok:false, error:String(e?.message||e) });
  }
}
