// api/ingest.js
import { fetchUpbitNotices } from "../lib/sources/upbit.js";
import { fetchUpbitFromCoinCarp } from "../lib/sources/upbit_coincarp.js";
import { fetchUnlocksRemote } from "../lib/sources/unlocks_remote.js";
import { supabase } from "../lib/db.js";

async function sendDiscord(msg){
  const hook=process.env.DISCORD_WEBHOOK_URL;
  if(!hook) return;
  await fetch(hook,{ method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ content: msg }) });
}

export default async function handler(req,res){
  try{
    const body=req.method==="POST"?req.body:{};
    const dryRun=Boolean(body?.dryRun);

    // (선택) 작업 키
    const key=req.headers["x-cron-secret"];
    if(process.env.CRON_SECRET && key!==process.env.CRON_SECRET){
      return res.status(200).json({ ok:false, error:"unauthorized" });
    }

    // 1) 소스 수집 (병렬)
    const [upbitDirect, upbitCoinCarp, unlocks] = await Promise.all([
      fetchUpbitNotices().catch(()=>[]),
      fetchUpbitFromCoinCarp().catch(()=>[]),
      fetchUnlocksRemote?.().catch(()=>[]) ?? []
    ]);

    // 2) 합치고 정규화 컬럼만 저장
    const events = [...upbitDirect, ...upbitCoinCarp, ...unlocks];
    const COLS = ["source","source_id","title","url","symbols","category","polarity","impact","confidence","starts_at"];
    const payload = events.map(e=>{ const o={}; for(const k of COLS) o[k]=e[k]??null; return o; });

    let inserted=0, newOnes=[];
    if(!dryRun && payload.length){
      const { data, error } = await supabase
        .from("events")
        .upsert(payload, { onConflict:"source,source_id", ignoreDuplicates:true })
        .select("id,source,source_id,title,impact,category,polarity,starts_at,symbols,url");
      if(error) throw error;
      newOnes=data||[]; inserted=newOnes.length;
    }

    // 3) 알림(impact ≥ 8)
    for(const ev of newOnes){
      if((ev.impact??0) >= 8){
        const syms=(ev.symbols||[]).slice(0,5).join(",");
        await sendDiscord(`**[${ev.source}] ${ev.title}**\n${ev.url||""}\ncat=${ev.category} impact=${ev.impact}${syms?` | ${syms}`:""}`);
      }
    }

    return res.status(200).json({
      ok:true, dryRun,
      fetched: { upbitDirect: upbitDirect.length, upbitCoinCarp: upbitCoinCarp.length, unlocks: unlocks.length },
      inserted,
      samples: events.slice(0,5)
    });
  }catch(e){
    return res.status(200).json({ ok:false, error:String(e?.message||e) });
  }
}
