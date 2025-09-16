// api/ingest.js
import { fetchUpbitNotices } from "../lib/sources/upbit.js";
import { fetchUpbitFromCoinCarp } from "../lib/sources/upbit_coincarp.js";
import { fetchBithumbFromCoinCarp } from "../lib/sources/bithumb_coincarp.js";
import { supabase } from "../lib/db.js";

async function sendDiscord(msg){
  const hook = process.env.DISCORD_WEBHOOK_URL; if(!hook) return;
  await fetch(hook, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ content: msg }) });
}

export default async function handler(req,res){
  try{
    // (선택) 크론 시크릿
    const key=req.headers["x-cron-secret"];
    if(process.env.CRON_SECRET && key!==process.env.CRON_SECRET){
      return res.status(200).json({ ok:false, stage:"auth", error:"unauthorized" });
    }

    const body=req.method==="POST"?req.body:{};
    const dryRun=Boolean(body?.dryRun);

    // 1) 수집 (병렬, 실패 무시)
    const [upbitDirect, upbitCoinCarp, bithumbCoinCarp] = await Promise.all([
      fetchUpbitNotices().catch(()=>[]),
      fetchUpbitFromCoinCarp().catch(()=>[]),
      fetchBithumbFromCoinCarp().catch(()=>[])
    ]);

    const events = [...upbitDirect, ...upbitCoinCarp, ...bithumbCoinCarp];

    // 2) 저장
    let inserted=0, newOnes=[];
    if(!dryRun && events.length){
      const cols=["source","source_id","title","url","symbols","category","polarity","impact","confidence","starts_at"];
      const payload=events.map(e=>{ const o={}; for(const k of cols) o[k]=e?.[k]??null; return o; });
      const { data, error } = await supabase
        .from("events")
        .upsert(payload, { onConflict:"source,source_id", ignoreDuplicates:true })
        .select("id,source,source_id,title,impact,category,polarity,starts_at,symbols,url");
      if(error) return res.status(200).json({ ok:false, stage:"upsert", error:String(error?.message||error) });
      newOnes=data||[]; inserted=newOnes.length;
    }

    // 3) 알림 (impact >= 8)
    if(!dryRun && inserted){
      for(const ev of newOnes){
        if((ev.impact??0) >= 8){
          const syms=(ev.symbols||[]).slice(0,5).join(",");
          await sendDiscord(`**[${ev.source}] ${ev.title}**\n${ev.url||""}\ncat=${ev.category} impact=${ev.impact}${syms?` | ${syms}`:""}`);
        }
      }
    }

    return res.status(200).json({
      ok:true, dryRun,
      fetched:{ upbitDirect:upbitDirect.length, upbitCoinCarp:upbitCoinCarp.length, bithumbCoinCarp:bithumbCoinCarp.length },
      inserted,
      samples: events.slice(0,5)
    });
  }catch(e){
    return res.status(200).json({ ok:false, stage:"top", error:String(e?.message||e) });
  }
}
