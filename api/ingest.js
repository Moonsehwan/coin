import { fetchUpbitNotices } from "../lib/sources/upbit.js";
// 필요시 빗썸 등 다른 소스도 여기서 합치고, supabase 저장 로직을 try/catch로 감싸세요.

export default async function handler(req, res) {
  try {
    const body = (req.method === "POST") ? req.body : {};
    const dryRun = Boolean(body?.dryRun);

    const upbit = await fetchUpbitNotices(); // 내부에서 실패하면 throw될 수 있음
    const events = upbit; // 다른 소스 합칠 거면 [...upbit, ...bithumb] 형태

    let inserted = 0;
    if (!dryRun) {
      // 여기에 Supabase upsert 로직
      // try/catch로 감싸고, 실패시 inserted=0 유지
    }

    return res.status(200).json({
      ok: true,
      dryRun,
      inserted,
      samples: events.slice(0, 5)
    });
  } catch (e) {
    console.error("[ingest] crash:", e?.stack || e);
    return res.status(200).json({
      ok: false,
      error: String(e?.message || e),
      stack: String(e?.stack || "")
    });
  }
}