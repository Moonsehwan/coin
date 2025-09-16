// lib/sources/upbit.js — Upbit announcements first, notices fallback, sitemap last
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CoinCalendarBot/1.1";
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
  const out = { ok: r.ok, status: r.status, url };
  try{
    out.body = ct.includes("json") ? await r.json() : await r.text();
  }catch(e){
    out.body = null;
  }
  return out;
}

function normalize(it){
  const title = it.title || it.subject || it.name || "";
  const id = String(it.id ?? it.noticeId ?? it.uuid ?? it.slug ?? it.url ?? title);
  const created = it.created_at || it.createdAt || it.reg_dt || it.timestamp || Date.now();

  // 심볼 후보 추출 (제목의 괄호/대문자 토큰)
  const syms = new Set();
  (title.match(/\(([^)]+)\)/g) || []).forEach(g=>{
    g.replace(/[()]/g,"").split(/[\/,\s·・,]+/).forEach(s=>{
      if (/^[A-Z0-9]{2,10}$/.test(s)) syms.add(s);
    });
  });

  // 카테고리 추정
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

  // URL 보정
  const url = it.url || it.link || it.share_url || it.path ||
              `https://upbit.com/service_center/notice?id=${encodeURIComponent(id)}`;

  return {
    source: "Upbit",
    source_id: id,
    title,
    url,
    symbols: Array.from(syms).slice(0,8),
    category,
    polarity,
    impact,
    confidence: 0.6,
    starts_at: new Date(created).toISOString(),
    raw: it,
  };
}

export async function fetchUpbitNotices(){
  const tried = [];
  let items = [];

  // 1) NEW: announcements (모바일 웹 파라미터 맞춰서)
  // 확인된 패턴: /api/v1/announcements?os=moweb&page=1&per_page=30&category=notice
  const annBase = "https://api-manager.upbit.com/api/v1/announcements";
  const categories = ["notice","market","wallet","policy"]; // 없는 건 자동 404 무시
  for (const cat of categories){
    const url = `${annBase}?os=moweb&page=1&per_page=50&category=${encodeURIComponent(cat)}`;
    const r = await jget(url);
    tried.push({ via:`announcements:${cat}`, url, status:r.status });
    if (r.ok && r.body){
      const list = r.body?.data?.list || r.body?.list || r.body?.data || [];
      if (Array.isArray(list)) items.push(...list.map(normalize));
    }
  }

  // 2) OLD: notices (구버전, 혹시 살아있으면)
  if (items.length === 0){
    const oldBase = "https://api-manager.upbit.com/api/v1/notices";
    const threads = ["general","wallet","market","policy"];
    for (const th of threads){
      const url = `${oldBase}?page=1&per_page=50&thread_name=${encodeURIComponent(th)}`;
      const r = await jget(url);
      tried.push({ via:`notices:${th}`, url, status:r.status });
      if (r.ok && r.body){
        const list = r.body?.data?.list || r.body?.list || r.body?.data || [];
        if (Array.isArray(list)) items.push(...list.map(normalize));
      }
    }
  }

  // 3) Fallback: sitemap (마지막 안전망, 제목은 '공지')
  if (items.length === 0){
    const url = "https://upbit.com/sitemap.xml";
    const r = await jget(url);
    tried.push({ via:"sitemap", url, status:r.status });
    if (r.ok && typeof r.body === "string"){
      const urls = Array.from(r.body.matchAll(/<loc>([^<]+service_center[^<]+)<\/loc>/g)).slice(0,50).map(m=>m[1]);
      items = urls.map(u => normalize({ title:"공지", url:u, id:u }));
    }
  }

  // dedup by source_id
  const seen = new Set();
  const dedup = [];
  for (const it of items){
    if (seen.has(it.source_id)) continue;
    seen.add(it.source_id);
    dedup.push(it);
  }

  // 프로브용 힌트
  dedup.tried = tried;
  return dedup;
}