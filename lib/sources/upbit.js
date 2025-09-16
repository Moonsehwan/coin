// lib/sources/upbit.js — robust collector (announcements, notices/search, notices, html)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CoinCalendarBot/1.4";
const ORIGIN = "https://upbit.com";
const REFERER = "https://upbit.com/service_center/notice";
const AL = "ko-KR,ko;q=0.9,en;q=0.8";

async function jget(url){
  const r = await fetch(url, {
    headers: {
      "user-agent": UA,
      "origin": ORIGIN,
      "referer": REFERER,
      "accept": "application/json,text/html,*/*",
      "accept-language": AL,
      "cache-control": "no-cache",
    }
  });
  const ct = r.headers.get("content-type") || "";
  let body = null;
  try { body = ct.includes("json") ? await r.json() : await r.text(); } catch {}
  return { ok: r.ok, status: r.status, url, body, ct };
}

function normalize(it){
  const title = it?.title || it?.subject || it?.name || "";
  const id = String(it?.id ?? it?.noticeId ?? it?.uuid ?? it?.slug ?? it?.url ?? title);
  const created = it?.created_at || it?.createdAt || it?.reg_dt || it?.timestamp || Date.now();

  // symbol candidates
  const syms = new Set();
  (title.match(/\(([^)]+)\)/g) || []).forEach(g=>{
    g.replace(/[()]/g,"").split(/[\/,\s·・,]+/).forEach(s=>{ if(/^[A-Z0-9]{2,10}$/.test(s)) syms.add(s); });
  });

  // category guess
  const t = title;
  const has = (kw)=> t.includes(kw);
  let category="other", impact=5, polarity="neutral";
  if (has("상장")){ category="listing"; impact=8; polarity="bull"; }
  else if (has("상폐")||has("유의종목")||has("유의 지정")){ category="delist"; impact=9; polarity="bear"; }
  else if (has("입출금")||has("지갑")){ category="wallet"; impact=6; }
  else if (has("점검")||has("중단")||has("재개")){ category="maintenance"; impact=5; }
  else if (has("업그레이드")||has("하드포크")||has("메인넷")){ category="upgrade"; impact=7; }
  else if (has("보안")||has("해킹")||has("익스플로잇")){ category="security"; impact=9; polarity="bear"; }
  else if (has("거버넌스")||has("소각")||has("발행")||has("수수료")||has("유동성")){ category="governance"; impact=7; }
  else if (has("파트너십")||has("제휴")){ category="partnership"; impact=6; }

  const url = it?.url || it?.link || it?.share_url || it?.path ||
              `https://upbit.com/service_center/notice?id=${encodeURIComponent(id)}`;

  return {
    source:"Upbit",
    source_id:id,
    title,
    url,
    symbols:Array.from(syms).slice(0,8),
    category, polarity, impact,
    confidence:0.6,
    starts_at:new Date(created).toISOString()
  };
}

// HTML fallback: parse links from notice list page
function parseHtmlList(html){
  const out = [];
  const re = /<a[^>]+href="(\/service_center\/notice[^"]+)"[^>]*>(.*?)<\/a>/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const title = m[2].replace(/<[^>]+>/g,"").trim();
    const url = "https://upbit.com" + href;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      source:"Upbit",
      source_id:url,
      title: title || "공지",
      url,
      symbols:[],
      category:"other",
      polarity:"neutral",
      impact:5,
      confidence:0.5,
      starts_at:new Date().toISOString()
    });
  }
  return out;
}

export async function tryFetchListWithDebug(){
  const tried = [];
  let items = [];
  let via = null;

  // 1) announcements (variants)
  const annBase = "https://api-manager.upbit.com/api/v1/announcements";
  const cats = ["notice","market","wallet","policy"];
  const annParams = [
    (c)=>`${annBase}?os=web&region=kr&page=1&per_page=50&category=${encodeURIComponent(c)}`,
    (c)=>`${annBase}?page=1&per_page=50&category=${encodeURIComponent(c)}`, // no os/region
  ];
  for (const gen of annParams){
    for (const c of cats){
      const url = gen(c);
      const r = await jget(url);
      tried.push({ via:`announcements:${c}`, url, status:r.status });
      if (r.ok && r.body){
        const list = r.body?.data?.list || r.body?.list || r.body?.data || [];
        if (Array.isArray(list) && list.length){
          items.push(...list.map(normalize));
          via = via || `announcements:${c}`;
        }
      }
    }
    if (items.length) break;
  }

  // 2) notices/search (older search API; requires partition/target/thread_name)
  if (!items.length){
    const base = "https://api-manager.upbit.com/api/v1/notices/search";
    const threads = ["general","wallet","market","policy"];
    for (const th of threads){
      // 일부 400 회피용: search에 공백(+) 또는 '공지'를 줘본다
      const queries = ["%20", "%EA%B3%B5%EC%A7%80"]; // " " , "공지"
      for (const q of queries){
        const url = `${base}?search=${q}&page=1&per_page=50&partition=1&target=non_ios&thread_name=${encodeURIComponent(th)}`;
        const r = await jget(url);
        tried.push({ via:`notices-search:${th}`, url, status:r.status });
        if (r.ok && r.body){
          const list = r.body?.data?.list || r.body?.list || r.body?.data || r.body?.items || [];
          if (Array.isArray(list) && list.length){
            items.push(...list.map(normalize));
            via = via || `notices-search:${th}`;
          }
        }
      }
    }
  }

  // 3) notices (very old)
  if (!items.length){
    const oldBase="https://api-manager.upbit.com/api/v1/notices";
    const ths=["general","wallet","market","policy"];
    for(const th of ths){
      const url=`${oldBase}?page=1&per_page=50&thread_name=${encodeURIComponent(th)}`;
      const r=await jget(url);
      tried.push({ via:`notices:${th}`, url, status:r.status });
      if (r.ok && r.body){
        const list=r.body?.data?.list || r.body?.list || r.body?.data || [];
        if (Array.isArray(list) && list.length){
          items.push(...list.map(normalize));
          via = via || `notices:${th}`;
        }
      }
    }
  }

  // 4) HTML fallback (SSR/static)
  if (!items.length){
    const pages = [
      "https://upbit.com/service_center/notice",
      "https://upbit.com/service_center/notice?page=1",
      "https://upbit.com/service_center/notice?per_page=50"
    ];
    for (const u of pages){
      const r = await jget(u);
      tried.push({ via:"html", url:u, status:r.status });
      if (r.ok && typeof r.body === "string"){
        const list = parseHtmlList(r.body);
        if (list.length){ items.push(...list); via = "html"; break; }
      }
    }
  }

  // dedup
  const seen=new Set(); const out=[];
  for (const it of items){ if (seen.has(it.source_id)) continue; seen.add(it.source_id); out.push(it); }
  return { via, tried, items: out };
}

export async function fetchUpbitNotices(){
  const r = await tryFetchListWithDebug();
  return r.items;
}
