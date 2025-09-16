// api/probe-upbit.js
import { fetchUpbitNoticesDebug } from "../lib/sources/upbit.js";

export default async function handler(req,res){
  try{
    const { events, tried } = await fetchUpbitNoticesDebug();
    return res.status(200).json({
      ok: true,
      via: events.length ? "html/sitemap" : null,
      count: events.length,
      tried,
      sample: events.slice(0,5)
    });
  }catch(e){
    return res.status(200).json({ ok:false, error:String(e?.message||e) });
  }
}
