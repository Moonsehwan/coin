// api/probe-upbit.js — calls tryFetchListWithDebug and returns details
import { tryFetchListWithDebug } from "../lib/sources/upbit.js";

export default async function handler(req, res){
  try{
    const r = await tryFetchListWithDebug();
    return res.status(200).json({
      ok: true,
      via: r.via,
      count: r.items.length,
      tried: r.tried,
      sample: r.items.slice(0,5)
    });
  }catch(e){
    return res.status(200).json({ ok:false, stage:"run", error:String(e?.message||e), stack:String(e?.stack||"") });
  }
}
