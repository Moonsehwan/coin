const UPBIT_MARKETS_URL = "https://api.upbit.com/v1/market/all?isDetails=false";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const COMMON_HEADERS = {
  "accept": "text/html,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
  "user-agent": UA,
  "origin": "https://upbit.com",
  "referer": "https://upbit.com/service_center/notice",
  "cache-control": "no-cache",
};

function escapeRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&"); }
function stripTags(s){ return String(s||"").replace(/<[^>]+>/g,"").trim(); }
function decodeEntities(s){
  return String(s||"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}

async function fetchText(url, headers=COMMON_HEADERS){
  const r = await fetch(url, { headers });
  const text = await r.text();
  return { status: r.status, text };
}
async function fetchJSON(url, headers=COMMON_HEADERS){
  const r = await fetch(url, { headers });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

// ---- 프록시 (r.jina.ai) ----
function toProxyUrl(url){
  const stripped = url.replace(/^https?:\/\//, "");
  return `https://r.jina.ai/http://${stripped}`;
}
async function fetchTextViaProxy(url){
  const proxy = toProxyUrl(url);
  const r = await fetchText(proxy, { ...COMMON_HEADERS, origin:"https://r.jina.ai", referer:"https://r.jina.ai" });
  return { ...r, proxy };
}
async function fetchJSONViaProxy(url){
  const proxy = toProxyUrl(url);
  const { status, text } = await fetchText(proxy, { ...COMMON_HEADERS, origin:"https://r.jina.ai", referer:"https://r.jina.ai" });
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status, json, text, proxy };
}

// ---- 업비트 마켓(심볼 추출용) ----
async function fetchUpbitMarkets() {
  const { status, json } = await fetchJSON(UPBIT_MARKETS_URL);
  if (status !== 200 || !Array.isArray(json)) return [];
  return json;
}

// ---- 목록 API (막혀 있으면 실패) ----
const BASES = [
  p=>`https://api-manager.upbit.com/api/v1/notices?page=${p}&per_page=50`,
  p=>`https://api-manager.upbit.com/api/v1/notices?os=web&page=${p}&per_page=50`,
  p=>`https://api-manager.upbit.com/api/v1/announcements?os=web&page=${p}&per_page=50`,
  p=>`https://api-manager.upbit.com/api/v1/announcements?os=web&page=${p}&per_page=50&category=notice`,
  p=>`https://api-manager.upbit.com/api/v1/announcements?os=web&page=${p}&per_page=50&category=NOTICE`,
  p=>`https://api-manager.upbit.com/api/v1/announcements?os=moweb&page=${p}&per_page=50&category=notice`,
];

function pickListShape(j){
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.data?.list)) return j.data.list;
  if (Array.isArray(j?.data?.rows)) return j.data.rows;
  if (Array.isArray(j?.data)) return j.data;
  if (Array.isArray(j?.list)) return j.list;
  return [];
}

// ---- HTML에서 공지 비슷한 항목 추출 (NEXT_DATA / a[href] 패턴) ----
function extractFromHtml(text){
  const out = [];

  // (A) __NEXT_DATA__ JSON에서 id/title 추출
  const m = text.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\\s\\S]*?)<\\/script>/i);
  if (m) {
    try {
      const next = JSON.parse(m[1]);
      const items = deepFindNoticeLike(next);
      out.push(...items.map(it => ({
        id: it.id,
        title: String(it.title || it.subject || it.name || "").trim(),
        url: it.url || it.link || it.share_url || (it.id ? `https://upbit.com/service_center/notice?id=${it.id}` : null)
      })));
    } catch {}
  }

  // (B) a[href*="/service_center/notice?"] 패턴
  const rx = /<a[^>]+href=["'](\\/service_center\\/notice[^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/ig;
  let mm; const arr=[];
  while ((mm = rx.exec(text)) && arr.length<150) {
    const href = mm[1];
    const title = stripTags(decodeEntities(mm[2]));
    const abs = `https://upbit.com${href}`;
    const idm = abs.match(/\\b(id|uid|no|notice_id)=([\\w-]+)/i);
    const id = idm ? idm[2] : abs;
    if (title) arr.push({ id, title, url: abs });
  }
  out.push(...arr);

  // 중복 제거
  const seen=new Set(); const uniq=[];
  for (const it of out) { const key=it.id||it.url||it.title; if(!seen.has(key)){ seen.add(key); uniq.push(it);} }
  return uniq;
}

function deepFindNoticeLike(root){
  const out = [];
  function walk(n){
    if (!n || typeof n!=="object") return;
    if (Array.isArray(n)) { for (const it of n) walk(it); return; }
    const id = n.id ?? n.notice_uuid ?? n.announcement_uuid ?? n.thread_id ?? null;
    const title = n.title ?? n.subject ?? n.name ?? null;
    if (id && title) out.push({ id, title, url: n.url || n.link || n.share_url || null });
    for (const k of Object.keys(n)) walk(n[k]);
  }
  walk(root);
  return out.slice(0,200);
}

// ---- (새로 추가) SITEMAP 기반 백업: 상세 URL 목록 → 상세 페이지에서 제목 추출 ----
async function fetchFromSitemap(){
  const sm = "https://upbit.com/sitemap.xml";
  // 프록시/직접 둘 다 시도
  const tried = [];
  for (const getter of [fetchText, fetchTextViaProxy]) {
    try {
      const r = await getter(sm);
      tried.push({ url: getter===fetchText ? sm : toProxyUrl(sm), status: r.status, via: getter===fetchText ? "direct-sitemap" : "proxy-sitemap" });
      if (r.status !== 200 || !r.text) continue;

      // <loc>URL</loc> 뽑기
      const locs = Array.from(r.text.matchAll(/<loc>([^<]+)<\\/loc>/g)).map(m=>m[1]);
      // 공지 상세 URL 필터
      const urls = locs.filter(u => /\\/service_center\\/notice/i.test(u)).slice(0, 40); // 최대 40개

      // 각 상세 페이지에서 제목 추출 (프록시 우선)
      const items = [];
      for (const u of urls) {
        let page = await fetchTextViaProxy(u);
        if (page.status !== 200 || !page.text) page = await fetchText(u);
        if (page.status !== 200 || !page.text) continue;

        // og:title > title > h1 순으로 시도
        const og = page.text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
        const tt = og || stripTags(page.text.match(/<title>([\\s\\S]*?)<\\/title>/i)?.[1] || "");
        const h1 = stripTags(page.text.match(/<h1[^>]*>([\\s\\S]*?)<\\/h1>/i)?.[1] || "");
        const title = (tt||h1).trim();
        if (!title) continue;

        const idm = u.match(/\\b(id|uid|no|notice_id)=([\\w-]+)/i);
        const id = idm ? idm[2] : u;

        items.push({ id, title, url: u });
        if (items.length >= 30) break; // 너무 많이 가져오지 않도록
      }
      if (items.length) return { ok:true, list: items, via:"sitemap-detail", tried };
    } catch (e) {
      tried.push({ url: getter===fetchText ? sm : toProxyUrl(sm), error: String(e) });
    }
  }
  return { ok:false, list:[], via:"sitemap-detail", tried: [] };
}

export async function tryFetchListWithDebug(page=1){
  const tried = [];

  // 1) JSON API 직접
  for (const build of BASES) {
    const url = build(page);
    try {
      const { status, json } = await fetchJSON(url);
      const list = pickListShape(json);
      tried.push({ url, status, length: list.length, via:"direct-json" });
      if (status===200 && list.length>0) return { ok:true, url, list, tried, via:"api" };
    } catch(e) { tried.push({ url, error:String(e), via:"direct-json" }); }
  }

  // 2) JSON API 프록시
  for (const build of BASES) {
    const url = build(page);
    try {
      const { status, json, proxy } = await fetchJSONViaProxy(url);
      const list = pickListShape(json);
      tried.push({ url: proxy, status, length: list.length, via:"proxy-json" });
      if (status===200 && list.length>0) return { ok:true, url: proxy, list, tried, via:"proxy-api" };
    } catch(e) { tried.push({ url: toProxyUrl(url), error:String(e), via:"proxy-json" }); }
  }

  // 3) HTML 직접/프록시 (리스트 페이지)
  for (const url of ["https://m.upbit.com/service_center/notice","https://upbit.com/service_center/notice"]) {
    try{
      const { status, text } = await fetchText(url);
      tried.push({ url, status, via:"direct-html" });
      if (status===200 && text) {
        const list = extractFromHtml(text);
        if (list.length) return { ok:true, url, list, tried, via:"html-direct" };
      }
    }catch(e){ tried.push({ url, error:String(e), via:"direct-html" }); }

    try{
      const { status, text, proxy } = await fetchTextViaProxy(url);
      tried.push({ url: proxy, status, via:"proxy-html" });
      if (status===200 && text) {
        const list = extractFromHtml(text);
        if (list.length) return { ok:true, url: proxy, list, tried, via:"html-proxy" };
      }
    }catch(e){ tried.push({ url: toProxyUrl(url), error:String(e), via:"proxy-html" }); }
  }

  // 4) SITEMAP → 상세 페이지 타이틀 추출 (새 백업 경로)
  const sm = await fetchFromSitemap();
  tried.push(...(sm.tried||[]));
  if (sm.ok && sm.list.length) return { ok:true, url:"https://upbit.com/sitemap.xml", list: sm.list, tried, via: sm.via };

  return { ok:false, url:null, list:[], tried };
}

// ---- 이벤트 가공 (심볼/카테고리) ----
const rules = [
  { category: "listing",    rx: /(상장|거래지원\\s*(?:추가|개시)|Market\\s*(?:Addition|Launch)|New\\s*(?:Digital\\s*Asset|Listing))/i },
  { category: "delist",     rx: /(거래지원\\s*종료|상장폐지|Delisting|End\\s*of\\s*Market\\s*Support)/i },
  { category: "wallet",     rx: /(입출금|입금|출금|지갑\\s*(?:점검|중지|재개)|Deposit|Withdrawal|Wallet\\s*(?:Maintenance|Resume|Suspend))/i },
  { category: "upgrade",    rx: /(메인넷|하드포크|네트워크\\s*(?:업그레이드|이슈|점검)|Mainnet|Hard\\s*Fork|Network\\s*(?:Upgrade|Issue))/i },
  { category: "maintenance",rx: /(점검|Maintenance)/i },
  { category: "security",   rx: /(해킹|보안\\s*이슈|Exploit|Hack|Security)/i },
  { category: "governance", rx: /(거버넌스|소각|발행|수수료|유동성|Tokenomics|Burn|Mint|Fee|Liquidity)/i },
  { category: "partnership",rx: /(파트너십|상용화|제휴|Partnership|Integration|Rollout|Go\\s*Live)/i },
];

function classifyCategory(title="") {
  for (const r of rules) if (r.rx.test(title)) {
    switch (r.category) {
      case "listing":      return { category:"listing",    impact:7, polarity:"bull" };
      case "delist":       return { category:"delist",     impact:8, polarity:"bear" };
      case "wallet":       return { category:"wallet",     impact:6, polarity:"neutral" };
      case "upgrade":      return { category:"upgrade",    impact:6, polarity:"neutral" };
      case "maintenance":  return { category:"maintenance",impact:5, polarity:"neutral" };
      case "security":     return { category:"hack",       impact:9, polarity:"bear" };
      case "governance":   return { category:"tokenomics", impact:6, polarity:"neutral" };
      case "partnership":  return { category:"partnership",impact:6, polarity:"bull" };
    }
  }
  return { category:"other", impact:5, polarity:"neutral" };
}

function extractSymbols(title, markets) {
  const syms = new Set(); const t = String(title||"");
  for (const m of markets) {
    const base = m.market.split("-")[1];
    const rxEn = new RegExp(`\\b(${base}|${m.english_name})\\b`, "i");
    const rxKr = m.korean_name ? new RegExp(escapeRe(m.korean_name), "i") : null;
    if (rxEn.test(t) || (rxKr && rxKr.test(t))) syms.add(base.toUpperCase());
  }
  return Array.from(syms);
}

export async function fetchUpbitNotices() {
  const markets = await fetchUpbitMarkets();
  const { ok, url: sourceUrl, list, tried, via } = await tryFetchListWithDebug(1);
  if (!ok) throw new Error(`모든 경로 실패: ${JSON.stringify(tried)}`);

  const events = [];
  for (const it of list) {
    const id = it.id ?? it.uuid ?? it.notice_uuid ?? it.announcement_uuid ?? it.thread_id ?? it.slug ?? null;
    const title = String(it.title || it.subject || it.name || "").trim();
    if (!title) continue;
    const link = it.url || it.mobile_url || it.link || it.share_url || (id ? `https://upbit.com/service_center/notice?id=${id}` : "https://upbit.com/service_center/notice");

    const { category, impact, polarity } = classifyCategory(title);
    const symbols = extractSymbols(title, markets);

    events.push({
      source:"Upbit",
      source_id: String(id ?? link).slice(0,200),
      title,
      description: null,
      url: link,
      symbols,
      category, polarity, impact,
      confidence: via?.includes("html") || via==="sitemap-detail" ? 0.6 : 0.7,
      starts_at: new Date().toISOString(),
      _debug_source: sourceUrl,
      _via: via
    });
  }

  // 추가 규칙
  for (const e of events) {
    if (/신규\\s*디지털\\s*자산|New\\s*Digital\\s*Asset/i.test(e.title)) { e.category="listing"; e.impact=Math.max(e.impact,7); e.polarity="bull"; }
    if (/거래지원\\s*종료|Delisting/i.test(e.title)) { e.category="delist"; e.impact=Math.max(e.impact,8); e.polarity="bear"; }
  }

  return events;
}