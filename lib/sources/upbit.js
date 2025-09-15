function clean(s=""){ return s.replace(/\s+/g," ").trim(); }
async function guessSymbolsFromTitle(title="") {
  try {
    const r = await fetch("https://api.upbit.com/v1/market/all?isDetails=false");
    if (!r.ok) return [];
    const markets = await r.json();
    const set = new Set(); const low = title.toLowerCase();
    for (const m of markets) {
      const en = (m.english_name||"").toLowerCase(), ko = m.korean_name||"";
      if ((en && low.includes(en)) || (ko && title.includes(ko))) {
        const base = (m.market||"KRW-XXX").split("-")[1];
        if (base) set.add(base);
      }
    }
    return [...set];
  } catch { return []; }
}
function detectCategory(title="") {
  const t = title.toLowerCase();
  if (/(???? ??|?? ??|??|delist)/.test(t)) return "delist";
  if (/(????|??|listed|listing)/.test(t)) return "listing";
  if (/(??|????|caution)/.test(t)) return "caution";
  if (/(???|??|??|maintenance|?????)/.test(t)) return "maintenance";
  if (/(mainnet|????|?????)/.test(t)) return "mainnet";
  return "other";
}
export async function fetchUpbitNotices(limit=30) {
  const url = "https://upbit.com/service_center/notice";
  const res = await fetch(url, { headers: { "accept-language": "ko" } });
  if (!res.ok) return [];
  const html = await res.text();
  const out = []; const seen = new Set();
  const re = /href="\/service_center\/notice\?id=(\d+)"[^>]*>([^<]+)<\/a>/g;
  let m; 
  while ((m = re.exec(html)) && out.length < limit) {
    const id = m[1]; if (seen.has(id)) continue; seen.add(id);
    const title = clean(m[2]);
    const category = detectCategory(title);
    const symbols = await guessSymbolsFromTitle(title);
    out.push({ source:"upbit_notice", source_id:id, title, description:"", url:`https://upbit.com/service_center/notice?id=${id}`, symbols, category, starts_at:new Date().toISOString() });
  }
  return out;
}