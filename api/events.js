import { createClient } from "@supabase/supabase-js";

function num(v, d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function parseList(v){ return !v ? [] : String(v).split(',').map(s=>s.trim()).filter(Boolean); }

export default async function handler(req, res) {
  try{
    const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE;
    if(!url || !key){
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ ok:false, error:"Missing Supabase envs"});
    }
    const sb=createClient(url, key, { auth: { persistSession: false }});

    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const limit=num(searchParams.get('limit'), 50);
    const offset=num(searchParams.get('offset'), 0);
    const minImpact=num(searchParams.get('minImpact'), 0);
    const category=searchParams.get('category'); // comma
    const symbolsParam=searchParams.get('symbols'); // comma
    const symbolParam=searchParams.get('symbol');   // single or comma
    const q=searchParams.get('q');               // text search
    const sinceHours=num(searchParams.get('sinceHours') ?? 24, 24);

    let query=sb.from('events')
      .select('id,source,source_id,title,description,url,symbols,category,polarity,impact,confidence,starts_at,created_at', { count:'exact' })
      .order('starts_at', { ascending:false })
      .range(offset, offset + Math.min(Math.max(limit,1),200) - 1);

    if(minImpact>0) query = query.gte('impact', minImpact);
    if(category){
      const arr=category.split(',').map(s=>s.trim()).filter(Boolean);
      if(arr.length) query = query.in('category', arr);
    }
    const sym = new Set([...parseList(symbolsParam), ...parseList(symbolParam)].map(s=>s.toUpperCase()));
    if(sym.size){
      const syms=[...sym];
      query = query.overlaps('symbols', syms);
    }
    if(q){
      query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
    }
    if(sinceHours>0){
      const iso = new Date(Date.now() - sinceHours*3600*1000).toISOString();
      query = query.gte('starts_at', iso);
    }

    const { data, error, count } = await query;
    res.setHeader('Access-Control-Allow-Origin', '*');
    if(error) return res.status(500).json({ ok:false, error: error.message });
    return res.status(200).json({ ok:true, count, items: data, rows: data });
  }catch(e){
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ ok:false, error: String(e) });
  }
}

