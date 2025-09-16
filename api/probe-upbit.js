// api/probe-upbit.js
import { tryFetchListWithDebug } from "../lib/sources/upbit.js";
import { fetchUpbitFromCoinCarp } from "../lib/sources/upbit_coincarp.js";

export default async function handler(req, res){
  try{
    const upbit = await tryFetchListWithDebug().catch(()=>({ via:null, tried:[], items:[] }));
    const carp  = await fetchUpbitFromCoinCarp().catch(()=>[]);
    return res.status(200).json({
      ok: true,
      via: upbit.via,
      count: upbit.items.length,
      tried: upbit.tried,
      sample: upbit.items.slice(0,5),
      fallback: { coinCarpCount: carp.length, coinCarpSample: carp.slice(0,5) }
    });
  }catch(e){
    return res.status(200).json({ ok:false, stage:"run", error:String(e?.message||e) });
  }
}
