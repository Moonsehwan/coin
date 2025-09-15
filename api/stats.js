import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res){
  try{
    const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE;
    if(!url || !key) return res.status(500).json({error:"Missing Supabase envs"});
    const sb=createClient(url, key, { auth: { persistSession: false }});

    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const sinceHours = Math.max(0, Number(searchParams.get("sinceHours")||24));
    const minImpact = Math.max(0, Number(searchParams.get("minImpact")||0));
    const sinceIso = new Date(Date.now()-sinceHours*3600*1000).toISOString();

    let q = sb.from("events")
      .select("symbols,category")
      .gte("created_at", sinceIso);
    if (minImpact>0) q = q.gte("impact", minImpact);

    const { data, error } = await q;
    if (error) return res.status(500).json({error:error.message});

    const cat = {};
    const sym = {};
    for (const r of (data||[])) {
      cat[r.category||"other"] = (cat[r.category||"other"]||0)+1;
      for (const s of (r.symbols||[])) {
        const u = (s||"").toUpperCase();
        if (u) sym[u] = (sym[u]||0)+1;
      }
    }

    const topSymbols = Object.entries(sym).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([s,c])=>({symbol:s,count:c}));
    res.status(200).json({ ok:true, sinceHours, minImpact, categories:cat, topSymbols });
  }catch(e){
    res.status(500).json({ error:String(e) });
  }
}