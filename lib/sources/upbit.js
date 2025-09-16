// lib/sources/upbit.js — robust v4
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CoinCalendarBot/1.6";
const ORIGIN = "https://upbit.com";
const REFERER = "https://upbit.com/service_center/notice";
const AL = "ko-KR,ko;q=0.9,en;q=0.8";

async function fetchAny(url){
  const r = await fetch(url, {
    headers: {
      "user-agent": UA,
      "origin": ORIGIN,
      "referer": REFERER,
      "accept": "application/json,text/html,text/plain,*/*",
      "accept-language": AL,
      "cache-control": "no-cache",
    }
  });
  const ct = r.headers.get("content-type") || "";
  let text=null, json=null;
  try {
    if (ct.includes("json")) json = await r.json();
    else { text = await r.text(); try { json = JSON.parse(text); } catch {} }
  } catch {}
  return { ok:r.ok, status:r.status, url, ct, text, json };
}

function normalize(it){
  const title = it?.title || it?.subject || it?.name || it?.text || "공지";
  const id = String(it?.id ?? it?.noticeId ?? it?.uuid ?? it?.slug ?? it?.url ?? title);
  const created = it?.created_at || it?.createdAt || it?.reg_dt || it?.timestamp || Date.now();

  // symbol candidates from title
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

// JSON 추정 파서 (announcements/notices/search 공통)
function extractListFromJson(j){
  if (!j) return [];
  const cands = [
    j?.data?.list, j?.data, j?.list, j?.items,
    j?.result?.list, j?.payload?.list
  ].filter(Array.isArray);
  if (cands.length) return cands[0];
  return [];
}

// HTML 리스트 파서들
function parseHtmlAnchors(html){
  const out=[], seen=new Set();
  const re = /<a[^>]+href="(\/service_center\/notice[^"]+)"[^>]*>(.*?)<\/a>/g;
  let m; 
  while((m=re.exec(html))!==null){
    const href=m[1], text=m[2].replace(/<[^>]+>/g,"").trim();
    const url="https://upbit.com"+href;
    if(seen.has(url)) continue; seen.add(url);
    out.push({ url, text, source:"Upbit", source_id:url, created_at: Date.now() });
  }
  return out;
}
function parseHtmlByIdScan(html){
  const out=[], seen=new Set();
  const re = /service_center\/notice\?id=(\d+)/g; let m;
  while((m=re.exec(html))!==null){
    const url=`https://upbit.com/service_center/notice?id=${m[1]}`;
    if(seen.has(url)) continue; seen.add(url);
    out.push({ url, text:"공지", source:"Upbit", source_id:url, created_at: Date.now() });
  }
  return out;
}
function toEvents(minis){ return minis.map(m=>normalize(m)); }

export async function tryFetchListWithDebug(){
  const tried=[]; let items=[]; let via=null;

  // 1) announcements (직접 + proxy)
  if(!items.length){
    const cats=["notice","market","wallet","policy"];
    const gens=[
      (c)=>`https://api-manager.upbit.com/api/v1/announcements?os=web&region=kr&page=1&per_page=50&category=${encodeURIComponent(c)}`,
      (c)=>`https://api-manager.upbit.com/api/v1/announcements?page=1&per_page=50&category=${encodeURIComponent(c)}`,
      (c)=>`https://r.jina.ai/http/https://api-manager.upbit.com/api/v1/announcements?os=web&region=kr&page=1&per_page=50&category=${encodeURIComponent(c)}`,
      (c)=>`https://r.jina.ai/http/https://api-manager.upbit.com/api/v1/announcements?page=1&per_page=50&category=${encodeURIComponent(c)}`
    ];
    outerA: for(const gen of gens){
      for(const c of cats){
        const url=gen(c); const r=await fetchAny(url);
        tried.push({ via:`announcements:${c}`, url, status:r.status });
        const list = extractListFromJson(r.json);
        if (list.length){ items.push(...list.map(normalize)); via=`announcements:${c}`; break outerA; }
      }
    }
  }

  // 2) notices/search (직접 + proxy)
  if(!items.length){
    const ths=["general","wallet","market","policy"];
    const gens=[
      (th)=>`https://api-manager.upbit.com/api/v1/notices/search?search=%EA%B3%B5%EC%A7%80&page=1&per_page=50&partition=1&target=non_ios&thread_name=${encodeURIComponent(th)}`,
      (th)=>`https://r.jina.ai/http/https://api-manager.upbit.com/api/v1/notices/search?search=%EA%B3%B5%EC%A7%80&page=1&per_page=50&partition=1&target=non_ios&thread_name=${encodeURIComponent(th)}`
    ];
    outerB: for(const gen of gens){
      for(const th of ths){
        const url=gen(th); const r=await fetchAny(url);
        tried.push({ via:`notices-search:${th}`, url, status:r.status });
        const list = extractListFromJson(r.json);
        if (list.length){ items.push(...list.map(normalize)); via=`notices-search:${th}`; break outerB; }
      }
    }
  }

  // 3) notices (아주 오래된; 직접 + proxy)
  if(!items.length){
    const ths=["general","wallet","market","policy"];
    const gens=[
      (th)=>`https://api-manager.upbit.com/api/v1/notices?page=1&per_page=50&thread_name=${encodeURIComponent(th)}`,
      (th)=>`https://r.jina.ai/http/https://api-manager.upbit.com/api/v1/notices?page=1&per_page=50&thread_name=${encodeURIComponent(th)}`
    ];
    outerC: for(const gen of gens){
      for(const th of ths){
        const url=gen(th); const r=await fetchAny(url);
        tried.push({ via:`notices:${th}`, url, status:r.status });
        const list = extractListFromJson(r.json);
        if (list.length){ items.push(...list.map(normalize)); via=`notices:${th}`; break outerC; }
      }
    }
  }

  // 4) HTML direct (여전히 실패하면)
  if(!items.length){
    const pages=[
      "https://upbit.com/service_center/notice",
      "https://upbit.com/service_center/notice?page=1",
      "https://upbit.com/service_center/notice?per_page=50"
    ];
    for(const u of pages){
      const r=await fetchAny(u);
      tried.push({ via:"html", url:u, status:r.status });
      if(r.ok && typeof r.text==="string"){
        let minis=parseHtmlAnchors(r.text);
        if(!minis.length) minis=parseHtmlByIdScan(r.text);
        if(minis.length){ items=toEvents(minis); via="html"; break; }
      }
    }
  }

  // 5) HTML via proxy (SSR 텍스트 보장)
  if(!items.length){
    const pages=[
      "https://r.jina.ai/http/https://upbit.com/service_center/notice",
      "https://r.jina.ai/http/https://upbit.com/service_center/notice?page=1",
      "https://r.jina.ai/http/https://upbit.com/service_center/notice?per_page=50"
    ];
    for(const u of pages){
      const r=await fetchAny(u);
      tried.push({ via:"html-proxy", url:u, status:r.status });
      if(r.ok && typeof r.text==="string"){
        let minis=parseHtmlAnchors(r.text);
        if(!minis.length) minis=parseHtmlByIdScan(r.text);
        if(minis.length){ items=toEvents(minis); via="html-proxy"; break; }
      }
    }
  }

  // dedup
  const seen=new Set(); const out=[];
  for(const it of items){ if(seen.has(it.source_id)) continue; seen.add(it.source_id); out.push(it); }
  return { via, tried, items: out };
}

export async function fetchUpbitNotices(){
  const r = await tryFetchListWithDebug();
  return r.items;
}
