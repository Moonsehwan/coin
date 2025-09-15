import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res){
  try{
    const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE;
    if(!url||!key) return res.status(500).json({error:"Missing Supabase envs"});

    const sb=createClient(url,key,{auth:{persistSession:false}});
    const n = Math.max(1, Math.min(10, Number(new URL(req.url, "http://x").searchParams.get("n")||3)));

    const now = new Date();
    const rows = Array.from({length:n}).map((_,i)=>({
      source:"Seed", source_id:`seed-${Date.now()}-${i}`,
      title:`[샘플] 업비트 상장 알림 #${i+1}`,
      description:"이건 샘플 데이터입니다.",
      url:"https://upbit.com/service_center/notice",
      symbols:["BTC","ETH","SOL"].slice(0, 1 + (i%3)),
      category:"listing", polarity:"bull",
      impact: 7 + (i%3),
      confidence: 0.8,
      starts_at: new Date(now.getTime() - i*60000).toISOString(),
      created_at: now.toISOString(),
      dedupe_hash: `seed-${Date.now()}-${i}`
    }));

    const { data, error } = await sb.from("events").insert(rows).select("id");
    if(error) return res.status(500).json({error:error.message});
    res.status(200).json({ ok:true, inserted: data.length });
  }catch(e){ res.status(500).json({ error:String(e) }); }
}