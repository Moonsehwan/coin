// lib/sources/upbit.js
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CoinCalendarBot/2.0";

async function fetchText(url){
  try{
    const r = await fetch(url, { headers:{ "user-agent": UA, "accept":"text/html,application/xhtml+xml,*/*" }});
    if(!r.ok) return { status:r.status, text:null };
    return { status:r.status, text: await r.text() };
  }catch(e){
    return { status:0, text:null };
  }
}

function abs(u){ return u.startsWith("http") ? u : ("https://upbit.com"+u); }

function parseNoticeListHTML(html){
  if(!html) return [];
  const out=[], seen=new Set();

  // a[href*="/service_center/notice"] 의 앵커 텍스트를 타이틀로 사용
  const re = /<a[^>]+href="(\/service_center\/notice[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m = re.exec(html))!==null){
    const url = abs(m[1]);
    if(seen.has(url)) continue;
    const raw = String(m[2]||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
    if(!raw) continue;
    // 업비트 목록에는 '공지', '점검' 등 키워드가 섞임 → 그대로 타이틀로.
    out.push({ url, title: raw });
    seen.add(url);
  }
  return out;
}

function parseSitemap(xml){
  if(!xml) return [];
  const urls = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while((m=re.exec(xml))!==null){
    const loc = m[1];
    if(/upbit\.com\/service_center\/notice/i.test(loc)){
      urls.push(loc);
    }
  }
  // 최신 상위 50개만
  return urls.slice(-50);
}

function roughCategorize(title){
  const t = title.toLowerCase();
  const has = (s)=>t.includes(s);
  let category="other", polarity="neutral", impact=5;

  if (has("상장") || /list(ing)?/i.test(t)) { category="listing"; polarity="bull"; impact=8; }
  else if (has("상폐") || has("유의") || /delist/i.test(t)) { category="delist"; polarity="bear"; impact=9; }
  else if (has("입출금") || has("지갑") || /deposit|withdraw/i.test(t)) { category="wallet"; impact=6; }
  else if (has("점검") || has("중단") || has("재개") || /suspend|resume/i.test(t)) { category="maintenance"; impact=5; }
  else if (has("업그레이드") || has("하드포크") || has("메인넷") || /upgrade|fork/i.test(t)) { category="upgrade"; impact=7; }

  // 심볼 추출: 괄호/슬래시/쉼표 안의 토큰들
  const syms = new Set();
  (title.match(/\(([A-Z0-9\/,\s-]{2,})\)/g)||[]).forEach(g=>{
    g.replace(/[()]/g,"").split(/[\/,\s·・,]+/).forEach(s=>{
      const x=s.trim().toUpperCase(); if(/^[A-Z0-9]{2,10}$/.test(x)) syms.add(x);
    });
  });

  return { category, polarity, impact, symbols: Array.from(syms).slice(0,8) };
}

export async function fetchUpbitNotices(){
  // 1순위: HTML 목록 페이지(직접)
  const tries = [
    { via:"html:per_page", url:"https://upbit.com/service_center/notice?per_page=50" },
    { via:"html:page1", url:"https://upbit.com/service_center/notice?page=1" },
    // 2순위: r.jina.ai 프록시 (프로토콜 없이)
    { via:"html-proxy:per_page", url:"https://r.jina.ai/http/upbit.com/service_center/notice?per_page=50" },
    { via:"html-proxy:page1", url:"https://r.jina.ai/http/upbit.com/service_center/notice?page=1" },
  ];

  for(const t of tries){
    const { text } = await fetchText(t.url);
    const rows = parseNoticeListHTML(text);
    if(rows.length){
      return rows.slice(0,50).map(({url,title})=>{
        const k = roughCategorize(title);
        return {
          source:"Upbit",
          source_id:url,
          title,
          url,
          symbols:k.symbols,
          category:k.category,
          polarity:k.polarity,
          impact:k.impact,
          confidence:0.6,
          starts_at:new Date().toISOString()
        };
      });
    }
  }

  // 3순위: 사이트맵에서 notice URL만 추출 후 제목은 상세페이지 <title>로 가져오기
  const smTries = [
    "https://upbit.com/sitemap.xml",
    "https://r.jina.ai/http/upbit.com/sitemap.xml"
  ];
  for(const u of smTries){
    const { text:xml } = await fetchText(u);
    const urls = parseSitemap(xml);
    if(urls.length){
      const out = [];
      for(const link of urls.slice(-30).reverse()){ // 최신쪽 우선
        const { text:html } = await fetchText(link);
        if(!html) continue;
        let title = "";
        const mOg = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
        const mT  = html.match(/<title[^>]*>([^<]{5,200})<\/title>/i);
        title = (mOg?.[1] || mT?.[1] || "").replace(/\s+/g," ").trim();
        if(!title) continue;
        const k = roughCategorize(title);
        out.push({
          source:"Upbit",
          source_id:link,
          title,
          url:link,
          symbols:k.symbols,
          category:k.category,
          polarity:k.polarity,
          impact:k.impact,
          confidence:0.55,
          starts_at:new Date().toISOString()
        });
      }
      if(out.length) return out.slice(0,50);
    }
  }

  return [];
}

// 디버그용: 시도한 경로와 상태를 보고 싶을 때
export async function fetchUpbitNoticesDebug(){
  const tried = [];
  const pushTried = (via,url,status,count)=>tried.push({via,url,status,count});

  // HTML 시도
  const htmlUrls = [
    { via:"html:per_page", url:"https://upbit.com/service_center/notice?per_page=50" },
    { via:"html:page1", url:"https://upbit.com/service_center/notice?page=1" },
    { via:"html-proxy:per_page", url:"https://r.jina.ai/http/upbit.com/service_center/notice?per_page=50" },
    { via:"html-proxy:page1", url:"https://r.jina.ai/http/upbit.com/service_center/notice?page=1" },
  ];
  for(const t of htmlUrls){
    const { status, text } = await fetchText(t.url);
    const rows = parseNoticeListHTML(text);
    pushTried(t.via, t.url, status, rows.length);
    if(rows.length){
      return { events: rows.map(r=>{
        const k = roughCategorize(r.title);
        return {
          source:"Upbit", source_id:r.url, title:r.title, url:r.url,
          symbols:k.symbols, category:k.category, polarity:k.polarity,
          impact:k.impact, confidence:0.6, starts_at:new Date().toISOString()
        };
      }), tried };
    }
  }

  // sitemap 시도
  const sm = [
    "https://upbit.com/sitemap.xml",
    "https://r.jina.ai/http/upbit.com/sitemap.xml"
  ];
  for(const u of sm){
    const { status, text } = await fetchText(u);
    const urls = parseSitemap(text);
    pushTried("sitemap", u, status, urls.length);
    if(urls.length){
      const events=[];
      for(const link of urls.slice(-20).reverse()){
        const { status:st2, text:html } = await fetchText(link);
        let title=""; 
        const mOg = html?.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
        const mT  = html?.match(/<title[^>]*>([^<]{5,200})<\/title>/i);
        title = (mOg?.[1] || mT?.[1] || "").replace(/\s+/g," ").trim();
        if(title){
          const k = roughCategorize(title);
          events.push({
            source:"Upbit", source_id:link, title, url:link,
            symbols:k.symbols, category:k.category, polarity:k.polarity,
            impact:k.impact, confidence:0.55, starts_at:new Date().toISOString()
          });
        }
        pushTried("sitemap-detail", link, st2, title?1:0);
      }
      if(events.length) return { events, tried };
    }
  }
  return { events:[], tried };
}
