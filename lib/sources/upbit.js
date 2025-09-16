// lib/sources/upbit.js  — Upbit Board API first, sitemap fallback
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CoinCalendarBot/1.0";
const ORIGIN = "https://upbit.com";
const REFERER = "https://upbit.com/service_center/notice";

async function jget(url){
  const r = await fetch(url, {
    headers: {
      "user-agent": UA,
      "origin": ORIGIN,
      "referer": REFERER,
      "accept": "application/json,text/html,*/*",
    }
  });
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("json")) return { ok: r.ok, json: await r.json(), status: r.status, url };
  return { ok: r.ok, text: await r.text(), status: r.status, url };
}

function normalizeItem(it){
  const title = it.title || it.subject || it.name || "";
  const id = String(
    it.id ?? it.noticeId ?? it.notice_id ?? it.uuid ?? it.slug ?? (it.url || title)
  );
  const created = it.created_at || it.createdAt || it.regDt || it.timestamp || new Date().toISOString();

  // 심볼 추출(제목 괄호/대문자 토큰 기반 best-effort)
  const symCandidates = [];
  const m = title.match(/\(([^)]+)\)/g) || [];
  for (const g of m){
    g.replace(/[()]/g,"").split(/[\/,\s·]+/).forEach(s=>{
      if (/^[A-Z0-9]{2,10}$/.test(s)) symCandidates.push(s);
    });
  }
  // 중복 제거
  const symbols = Array.from(new Set(symCandidates)).slice(0,8);

  // 카테고리 추정(ko 기준 키워드)
  const t = title;
  const has = (kw)=> t.includes(kw);
  let category = "other", impact = 5, polarity = "neutral";
  if (has("상장")) { category="listing"; impact=8; polarity="bull"; }
  else if (has("상폐") || has("유의종목") || has("유의 지정")) { category="delist"; impact=9; polarity="bear"; }
  else if (has("입출금") || has("지갑") ) { category="wallet"; impact=6; }
  else if (has("점검") || has("중단") || has("재개")) { category="maintenance"; impact=5; }
  else if (has("업그레이드") || has("하드포크") || has("메인넷")) { category="upgrade"; impact=7; }
  else if (has("보안") || has("해킹") || has("익스플로잇")) { category="security"; impact=9; polarity="bear"; }
  else if (has("거버넌스") || has("소각") || has("발행") || has("수수료") || has("유동성")) { category="governance"; impact=7; }
  else if (has("파트너십") || has("제휴")) { category="partnership"; impact=6; }

  // URL 베스트에포트(보드 API에 url 필드 없을 때 대비)
  const url = it.url || it.link || it.share_url || it.path || `https://upbit.com/service_center/notice?id=${encodeURIComponent(id)}`;

  return {
    source: "Upbit",
    source_id: id,
    title,
    url,
    symbols,
    category,
    polarity,
    impact,
    confidence: 0.6,
    starts_at: new Date(created).toISOString(),
    _raw: it,
  };
}

export async function fetchUpbitNotices(){
  const tried = [];
  let items = [];

  // 1) Board API (스레드 3종 시도)
  const base = "https://api-manager.upbit.com/api/v1/notices";
  const threads = ["general","wallet","market"];
  try {
    for (const th of threads){
      const url = `${base}?page=1&per_page=50&thread_name=${encodeURIComponent(th)}`;
      tried.push({ stage:"board", url });
      const r = await jget(url);
      if (r.ok && r.json && Array.isArray(r.json.data || r.json)){
        const arr = (r.json.data ?? r.json).filter(Boolean);
        items.push(...arr.map(normalizeItem));
      }
    }
  } catch (e) {
    tried.push({ stage:"board-error", error: String(e?.message||e) });
  }

  // 2) Fallback: sitemap (필요 시)
  if (items.length === 0){
    try {
      const sm = await jget("https://upbit.com/sitemap.xml");
      tried.push({ stage:"sitemap", status: sm.status });
      if (sm.ok && typeof sm.text === "string"){
        // 간단 파싱: 최근 notice 경로 일부만 추출(보수적)
        const urls = Array.from(sm.text.matchAll(/<loc>([^<]+service_center[^<]+)<\/loc>/g)).slice(0,50).map(m=>m[1]);
        items = urls.map(u => normalizeItem({ title: "공지", url: u, id: u }));
      }
    } catch (e) {
      tried.push({ stage:"sitemap-error", error: String(e?.message||e) });
    }
  }

  // 중복 제거(source_id 기준)
  const seen = new Set();
  const dedup = [];
  for (const it of items){
    if (seen.has(it.source_id)) continue;
    seen.add(it.source_id);
    dedup.push({
      source: it.source,
      source_id: it.source_id,
      title: it.title,
      url: it.url,
      symbols: it.symbols,
      category: it.category,
      polarity: it.polarity,
      impact: it.impact,
      confidence: it.confidence,
      starts_at: it.starts_at,
      raw: it._raw,
    });
  }

  return dedup;
}