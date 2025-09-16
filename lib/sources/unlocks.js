// lib/sources/unlocks.js
import fs from "node:fs/promises";
import path from "node:path";

export async function fetchUnlocks() {
  const p = path.join(process.cwd(), "static", "unlocks.csv");
  const csv = await fs.readFile(p, "utf8");
  const lines = csv.trim().split(/\r?\n/);
  const [header, ...rows] = lines;
  const H = header.split(",");
  const idx = (k)=>H.indexOf(k);

  const out = rows.map(r=>{
    const t = r.split(",");
    const symbol = (t[idx("symbol")]||"").toUpperCase();
    const title = `[락업] ${symbol} ${t[idx("pct_circulating")]}% 해제 예정`;
    const starts = new Date(t[idx("unlock_date")]).toISOString();
    const pct = parseFloat(t[idx("pct_circulating")]||"0");
    const impact = pct >= 5 ? 8 : pct >= 2 ? 6 : 4;   // 간단한 임팩트 룰
    return {
      source: "Unlocks",
      source_id: `${symbol}-${starts}`,
      title,
      url: t[idx("source")] || "",
      symbols: [symbol],
      category: "unlock",
      polarity: "bear",
      impact,
      confidence: 0.7,
      starts_at: starts,
      raw: { symbol, pct, amount: t[idx("amount")], usd: t[idx("usd")] }
    };
  });
  return out;
}
