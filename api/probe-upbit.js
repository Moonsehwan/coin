import { tryFetchListWithDebug } from "../lib/sources/upbit.js";

export default async function handler(req, res) {
  try {
    const r = await tryFetchListWithDebug(1);
    // 에러 없이 끝났지만 ok=false일 수도 있으니 그대로 노출
    return res.status(200).json({
      ok: r?.ok === true,
      via: r?.via ?? null,
      urlTried: r?.url ?? null,
      count: Array.isArray(r?.list) ? r.list.length : 0,
      tried: r?.tried ?? [],
      sample: Array.isArray(r?.list) ? r.list.slice(0, 5) : []
    });
  } catch (e) {
    console.error("[probe-upbit] crash:", e?.stack || e);
    // 절대 500 내지 말고 200으로 에러 메시지 전달
    return res.status(200).json({
      ok: false,
      error: String(e?.message || e),
      stack: String(e?.stack || "")
    });
  }
}