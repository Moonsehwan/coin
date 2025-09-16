// lib/sources/upbit.js — robust v3
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 CoinCalendarBot/1.5";
const ORIGIN = "https://upbit.com";
const REFERER = "https://upbit.com/service_center/notice";
const AL = "ko-KR,ko;q=0.9,en;q=0.8";

// --- helpers ---
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
    title: title || "공지",
    url,
    symbols:Array.from(syms).slice(0,8),
    category, polarity, impact,
    confidence:0.6,
    starts_at:new Date(created).toISOString()
  };
}

// --- HTML fallback parsers ---
function parseHtmlAnchors(html){
  // 1) 일반 앵커 태그에서 추출
  const out=[];
  const re = /href="(\/service_center\/notice[^"]+)"/g;
  const seen=new Set();
  let m;
  while((m=re.exec(html))!==null){
    const href=m[1];
    const url="https://upbit.com"+href;
    if(seen.has(url)) continue;
    seen.add(url);
    // 제목은 곧바로 찾기 어렵다면 URL만으로 생성
    out.push({ url, source:"Upbit", source_id:url, title:"공지", created_at: Date.now() });
  }
  return out;
}

function parseHtmlByIdScan(html){
  // 2) 앵커가 없다면, 그냥 id=숫자 패턴만 스캔해서 URL 구성
  const out=[];
  const seen=new Set();
  const re = /service_center\/notice\?id=(\d+)/g;
  let m;
  while((m=re.exec(html))!==null){
    const id=m[1];
    const url=`https://upbit.com/service_center/notice?id=${id}`;
    if(seen.has(url)) continue;
    seen.add(url);
    out.push({ url, source:"Upbit", source_id:url, title:"공지", created_at: Date.now() });
  }
  return out;
}

function toEvents(minimals){
  return minimals.map(m=>normalize(m));
}

// --- main with debug ---
export async function tryFetchListWithDebug(){
  const tried=[]; let items=[]; let via=null;

  // 1) announcements variants (여전히 시도; 실패시 넘어감)
  const annBase="https://api-manager.upbit.com/api/v1/announcements";
  const cats=["notice","market","wallet","policy"];
  const annParams=[
    (c)=>`${annBase}?os=web&region=kr&page=1&per_page=50&category=${encodeURIComponent(c)}`,
    (c)=>`${annBase}?page=1&per_page=50&category=${encodeURIComponent(c)}`
  ];
  outer1:
  for(const gen of annParams){
    for(const c of cats){
      const url=gen(c);
      const r=await jget(url);
      tried.push({ via:`announcements:${c}`, url, status:r.status });
      if(r.ok && r.body){
        const list=r.body?.data?.list || r.body?.list || r.body?.data || [];
        if(Array.isArray(list) && list.length){
          items.push(...list.map(normalize)); via=`announcements:${c}`; break outer1;
        }
      }
    }
  }

  // 2) notices/search (rate-limit/404면 건너뜀)
  if(!items.length){
    const base="https://api-manager.upbit.com/api/v1/notices/search";
    const threads=["general","wallet","market","policy"];
    for(const th of threads){
      const url=`${base}?search=%EA%B3%B5%EC%A7%80&page=1&per_page=50&partition=1&target=non_ios&thread_name=${encodeURIComponent(th)}`;
      const r=await jget(url);
      tried.push({ via:`notices-search:${th}`, url, status:r.status });
      if(r.status===429) continue; // 너무 두드리지 않음
      if(r.ok && r.body){
        const list=r.body?.data?.list || r.body?.list || r.body?.data || r.body?.items || [];
        if(Array.isArray(list) && list.length){
          items.push(...list.map(normalize)); via=`notices-search:${th}`; break;
        }
      }
    }
  }

  // 3) notices (아주 오래된; 429/404시 패스)
  if(!items.length){
    const base="https://api-manager.upbit.com/api/v1/notices";
    const ths=["general","wallet","market","policy"];
    for(const th of ths){
      const url=`${base}?page=1&per_page=50&thread_name=${encodeURIComponent(th)}`;
      const r=await jget(url);
      tried.push({ via:`notices:${th}`, url, status:r.status });
      if(r.ok && r.body){
        const list=r.body?.data?.list || r.body?.list || r.body?.data || [];
        if(Array.isArray(list) && list.length){
          items.push(...list.map(normalize)); via=`notices:${th}`; break;
        }
      }
    }
  }

  // 4) HTML direct
  if(!items.length){
    const pages=[
      "https://upbit.com/service_center/notice",
      "https://upbit.com/service_center/notice?page=1",
      "https://upbit.com/service_center/notice?per_page=50"
    ];
    for(const u of pages){
      const r=await jget(u);
      tried.push({ via:"html", url:u, status:r.status });
      if(r.ok && typeof r.body==="string"){
        let minis=parseHtmlAnchors(r.body);
        if(!minis.length) minis=parseHtmlByIdScan(r.body);
        if(minis.length){ items=toEvents(minis); via="html"; break; }
      }
    }
  }

  // 5) HTML via r.jina.ai proxy (서버 사이드 렌더링이 빈약한 경우)
  if(!items.length){
    const pgs=[
      "https://r.jina.ai/http/https://upbit.com/service_center/notice",
      "https://r.jina.ai/http/https://upbit.com/service_center/notice?page=1",
      "https://r.jina.ai/http/https://upbit.com/service_center/notice?per_page=50"
    ];
    for(const u of pgs){
      const r=await jget(u);
      tried.push({ via:"html-proxy", url:u, status:r.status });
      if(r.ok && typeof r.body==="string"){
        let minis=parseHtmlAnchors(r.body);
        if(!minis.length) minis=parseHtmlByIdScan(r.body);
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
