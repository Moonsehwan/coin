const UPBIT_MARKETS_URL = "https://api.upbit.com/v1/market/all?isDetails=false";
const API_BASE = "https://api-manager.upbit.com/api/v1";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const COMMON_HEADERS = {
  "accept": "application/json,text/html;q=0.9,*/*;q=0.8",
  "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
  "user-agent": UA,
  "origin": "https://upbit.com",
  "referer": "https://upbit.com/service_center/notice",
  "cache-control": "no-cache",
};

function stripTags(s){ return String(s||"").replace(new RegExp("<[^>]+>","g"),"").trim(); }
function decodeEntities(s){
  s = String(s||"");
  s = s.split("&amp;").join("&").split("&lt;").join("<").split("&gt;").join(">")
       .split("&quot;").join('"').split("&#39;").join("'");
  return s;
}
function escapeRe(s){ return String(s||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }

async function fetchText(url, headers=COMMON_HEADERS){
  const r = await fetch(url, { headers });
  const text = await r.text();
  return { status: r.status, text };
}
async function fetchJSON(url, headers=COMMON_HEADERS){
  const r = await fetch(url, { headers });
  const t = await r.text();
  let j=null; try{ j=JSON.parse(t); }catch{}
  return { status: r.status, json: j, text: t };
}
function toProxy(url){ return "https://r.jina.ai/http/" + url.replace(/^https?:\/\//,""); }
async function fetchTextProxy(url){ return fetchText(toProxy(url), { ...COMMON_HEADERS, origin:"https://r.jina.ai", referer:"https://r.jina.ai" }); }

async function fetchUpbitMarkets(){
  try{
    const { status, json } = await fetchJSON(UPBIT_MARKETS_URL);
    if (status===200 && Array.isArray(json)) return json;
  }catch{}
  return [];
}

/** ---------- 분류 규칙 ---------- */
const R = {
  listing: "(상장|거래지원\\s*(?:추가|개시)|Market\\s*(?:Addition|Launch)|New\\s*(?:Digital\\s*Asset|Listing))",
  delist: "(거래지원\\s*종료|상장폐지|Delisting|End\\s*of\\s*Market\\s*Support)",
  wallet: "(입출금|입금|출금|지갑\\s*(?:점검|중지|재개)|Deposit|Withdrawal|Wallet\\s*(?:Maintenance|Resume|Suspend))",
  upgrade: "(메인넷|하드포크|네트워크\\s*(?:업그레이드|이슈|점검)|Mainnet|Hard\\s*Fork|Network\\s*(?:Upgrade|Issue))",
  maintenance: "(점검|Maintenance)",
  security: "(해킹|보안\\s*이슈|Exploit|Hack|Security)",
  governance: "(거버넌스|소각|발행|수수료|유동성|Tokenomics|Burn|Mint|Fee|Liquidity)",
  partnership: "(파트너십|상용화|제휴|Partnership|Integration|Rollout|Go\\s*Live)",
};
const RX = Object.fromEntries(Object.entries(R).map(([k,v])=>[k, new RegExp(v,"i")]));
function classify(title=""){
  const t = String(title||"");
  if (RX.listing.test(t))      return { category:"listing",    impact:7, polarity:"bull" };
  if (RX.delist.test(t))       return { category:"delist",     impact:8, polarity:"bear" };
  if (RX.wallet.test(t))       return { category:"wallet",     impact:6, polarity:"neutral" };
  if (RX.upgrade.test(t))      return { category:"upgrade",    impact:6, polarity:"neutral" };
  if (RX.maintenance.test(t))  return { category:"maintenance",impact:5, polarity:"neutral" };
  if (RX.security.test(t))     return { category:"hack",       impact:9, polarity:"bear" };
  if (RX.governance.test(t))   return { category:"tokenomics", impact:6, polarity:"neutral" };
  if (RX.partnership.test(t))  return { category:"partnership",impact:6, polarity:"bull" };
  return { category:"other", impact:5, polarity:"neutral" };
}

/** ---------- Board API(공지 JSON) 1순위 ----------
 * 알려진 엔드포인트(스레드별):
 *   /api/v1/notices?page=1&per_page=50&thread_name=general
 *   /api/v1/notices?page=1&per_page=50&thread_name=wallet
 *   /api/v1/notices?page=1&per_page=50&thread_name=market
 *   /api/v1/notices?page=1&per_page=50&thread_name=policy
 * 스키마가 다를 수 있으니 deep 추출 + title/id/url 휴리스틱 적용
 */
const THREADS = ["general","wallet","market","policy"];
function normalizeBoardItems(any){
  // 가능한 키에서 id/title/url 유추
  const out=[];
  function pushOne(o){
    if (!o) return;
    const id = o.id ?? o.notice_id ?? o.uuid ?? o.notice_uuid ?? o.thread_id ?? o._id ?? null;
    const title = o.title ?? o.subject ?? o.name ?? o.text ?? null;
    const url = o.url ?? o.link ?? o.share_url ?? null;
    if (title) out.push({ id: String(id||"").slice(0,200) || null, title: String(title), url: url||null });
  }
  function walk(n){
    if (!n) return;
    if (Array.isArray(n)){ n.forEach(walk); return; }
    if (typeof n === "object"){
      if ("title" in n || "subject" in n) pushOne(n);
      for (const k of Object.keys(n)) walk(n[k]);
    }
  }
  walk(any);
  // 중복 제거
  const seen = new Set(), uniq=[];
  for (const it of out){
    const key = it.id || it.url || it.title;
    if (!seen.has(key)){ seen.add(key); uniq.push(it); }
  }
  return uniq;
}

async function fetchFromBoardApi(){
  const tried=[];
  for (const thread of THREADS){
    const url = `${API_BASE}/notices?page=1&per_page=50&thread_name=${encodeURIComponent(thread)}`;
    try{
      const { status, json, text } = await fetchJSON(url, {
        ...COMMON_HEADERS,
        // 일부 환경에서 locale/region 힌트가 필요할 수 있음
        // 헤더는 이미 referer/origin 설정됨
      });
      tried.push({ url, status, via:`board:${thread}` });
      if (status===200 && json){
        const items = normalizeBoardItems(json);
        if (items.length) return { ok:true, list: items, tried, via:`board:${thread}` };
      }
    }catch(e){
      tried.push({ url, error:String(e) });
    }
  }
  // 프록시(텍스트→JSON 파싱 재시도)
  for (const thread of THREADS){
    const url = `${API_BASE}/notices?page=1&per_page=50&thread_name=${encodeURIComponent(thread)}`;
    try{
      const { status, text } = await fetchText(toProxy(url));
      tried.push({ url: toProxy(url), status, via:`board-proxy:${thread}` });
      if (status===200 && text){
        let j=null; try{ j=JSON.parse(text); }catch{}
        const items = normalizeBoardItems(j);
        if (items.length) return { ok:true, list: items, tried, via:`board-proxy:${thread}` };
      }
    }catch(e){
      tried.push({ url: toProxy(url), error:String(e) });
    }
  }
  return { ok:false, list:[], tried, via:"board" };
}

/** ---------- 사이트맵 백업(개별 공지 URL이 안 실릴 수 있음) ---------- */
async function fetchFromSitemap(){
  const tried=[];
  const sm = "https://upbit.com/sitemap.xml";
  let site = await fetchTextProxy(sm);
  tried.push({ url: toProxy(sm), status: site.status, via:"proxy-sitemap" });
  if (site.status!==200 || !site.text){
    site = await fetchText(sm);
    tried.push({ url: sm, status: site.status, via:"direct-sitemap" });
  }
  if (site.status!==200 || !site.text) return { ok:false, list:[], tried, via:"sitemap-detail" };

  // <loc> 모으기
  const locRe = new RegExp("<loc>([^<]+)</loc>","g");
  const locs = Array.from(site.text.matchAll(locRe)).map(m=>m[1]);
  const urls = locs.filter(u=>/\/service_center\/notice/i.test(u)).slice(0,60);

  const items=[];
  for (const u of urls){
    let page = await fetchTextProxy(u);
    if (page.status!==200 || !page.text) page = await fetchText(u);
    if (page.status!==200 || !page.text) continue;

    const ogRe = new RegExp("<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"']([^\"']+)[\"']","i");
    const tRe  = new RegExp("<title>([\\s\\S]*?)<\\/title>","i");
    const h1Re = new RegExp("<h1[^>]*>([\\s\\S]*?)<\\/h1>","i");

    const og     = page.text.match(ogRe)?.[1];
    const tMatch = page.text.match(tRe)?.[1];
    const h1     = page.text.match(h1Re)?.[1];
    const title  = stripTags(decodeEntities(og || tMatch || h1 || ""));
    if (!title) continue;

    const idm = u.match(/\b(id|uid|no|notice_id)=([\w-]+)/i);
    const id  = idm ? idm[2] : u;

    items.push({ id, title, url: u });
    if (items.length>=30) break;
  }
  return { ok: items.length>0, list: items, tried, via:"sitemap-detail" };
}

/** ---------- 공개 API ---------- */
export async function tryFetchListWithDebug(){
  // 1) Board API 우선
  const a = await fetchFromBoardApi();
  if (a.ok) return { ok:true, url: `${API_BASE}/notices`, list:a.list, tried:a.tried, via:a.via };

  // 2) 실패 시 사이트맵 백업
  const b = await fetchFromSitemap();
  if (b.ok) return { ok:true, url:"https://upbit.com/sitemap.xml", list:b.list, tried:[...(a.tried||[]), ...(b.tried||[])], via:b.via };

  return { ok:false, url:null, list:[], tried:[...(a.tried||[]), ...(b.tried||[])], via:null };
}

export async function fetchUpbitNotices(){
  const markets = await fetchUpbitMarkets();
  const { ok, list, via } = await tryFetchListWithDebug();
  if (!ok) return [];

  const events=[];
  for (const it of list){
    const title = String(it.title||"").trim();
    if (!title) continue;
    const link = it.url || (it.id ? ("https://upbit.com/service_center/notice?id="+it.id) : "https://upbit.com/service_center/notice");
    const { category, impact, polarity } = classify(title);

    // 심볼 추정
    const syms=new Set();
    for (const m of markets){
      const base = String(m.market||"").split("-")[1];
      const en = m.english_name || "";
      if (!base) continue;
      const reEn = new RegExp("\\b("+escapeRe(base)+"|"+escapeRe(en)+")\\b","i");
      const reKr = m.korean_name ? new RegExp(escapeRe(m.korean_name),"i") : null;
      if (reEn.test(title) || (reKr && reKr.test(title))) syms.add(base.toUpperCase());
    }

    events.push({
      source: "Upbit",
      source_id: String(it.id||link).slice(0,200),
      title,
      description: null,
      url: link,
      symbols: Array.from(syms),
      category, polarity, impact,
      confidence: via && via.startsWith("board") ? 0.9 : (via==="sitemap-detail" ? 0.6 : 0.7),
      starts_at: new Date().toISOString(),
      _via: via
    });
  }
  return events;
}