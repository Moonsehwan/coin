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

function stripTags(s){ return String(s||"").replace(new RegExp("<[^>]+>","g"),"").trim(); }
function decodeEntities(s){
  return String(s||"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}
function escapeRe(s){ return String(s||"").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function fetchText(url, headers=COMMON_HEADERS){
  const r = await fetch(url, { headers });
  return { status: r.status, text: await r.text() };
}
async function fetchJSON(url, headers=COMMON_HEADERS){
  const r = await fetch(url, { headers });
  const t = await r.text();
  let j=null; try{ j=JSON.parse(t); }catch{}
  return { status: r.status, json: j, text: t };
}

// 프록시(r.jina.ai)
function toProxy(url){ return "https://r.jina.ai/http/" + url.replace(/^https?:\/\//,""); }
async function fetchTextProxy(url){ return fetchText(toProxy(url), { ...COMMON_HEADERS, origin:"https://r.jina.ai", referer:"https://r.jina.ai" }); }

async function fetchUpbitMarkets(){
  try{
    const { status, json } = await fetchJSON(UPBIT_MARKETS_URL);
    if (status===200 && Array.isArray(json)) return json;
  }catch{}
  return [];
}

// ---- 분류 규칙(리터럴 X, 전부 RegExp 생성)
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

function deepFindNoticeLike(root){
  const out=[];
  function walk(n){
    if (!n || typeof n!=="object") return;
    if (Array.isArray(n)){ for(const it of n) walk(it); return; }
    const id = n.id ?? n.notice_uuid ?? n.announcement_uuid ?? n.thread_id ?? null;
    const title = n.title ?? n.subject ?? n.name ?? null;
    if (id && title) out.push({ id, title, url: n.url || n.link || n.share_url || null });
    for (const k of Object.keys(n)) walk(n[k]);
  }
  walk(root);
  const seen=new Set(), uniq=[];
  for (const it of out){ const key=it.id||it.url||it.title; if(!seen.has(key)){ seen.add(key); uniq.push(it); } }
  return uniq.slice(0,150);
}

function extractLinksFromHtml(html){
  // a[href="/service_center/notice?..."] 캡처 (리터럴 X)
  const re = new RegExp("<a[^>]+href=[\"'](\\/service_center\\/notice[^\"']+)[\"'][^>]*>([\\s\\S]*?)<\\/a>","ig");
  const out=[]; let m;
  while ((m = re.exec(html)) && out.length<120){
    const href = m[1];
    const title = stripTags(decodeEntities(m[2]));
    const abs = "https://upbit.com" + href;
    const idm = abs.match(/\b(id|uid|no|notice_id)=([\w-]+)/i);
    const id = idm ? idm[2] : abs;
    if (title) out.push({ id, title, url: abs });
  }
  return out;
}

async function fetchFromSitemap(){
  const tried=[];
  const sm = "https://upbit.com/sitemap.xml";
  for (const getter of [fetchTextProxy, fetchText]){
    try{
      const r = await getter(sm);
      tried.push({ url: getter===fetchText ? sm : toProxy(sm), status: r.status, via: getter===fetchText ? "direct-sitemap" : "proxy-sitemap" });
      if (r.status!==200 || !r.text) continue;
      const locRe = new RegExp("<loc>([^<]+)</loc>","g");
      const locs = Array.from(r.text.matchAll(locRe)).map(m=>m[1]);
      const urls = locs.filter(u=>/\/service_center\/notice/i.test(u)).slice(0,40);

      const items=[];
      for (const u of urls){
        let page = await fetchTextProxy(u);
        if (page.status!==200 || !page.text) page = await fetchText(u);
        if (page.status!==200 || !page.text) continue;

        const og = page.text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
        const titleTag = page.text.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
        const h1 = page.text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
        const title = stripTags(decodeEntities(og || titleTag || h1 || ""));
        if (!title) continue;

        const idm = u.match(/\b(id|uid|no|notice_id)=([\w-]+)/i);
        const id = idm ? idm[2] : u;

        items.push({ id, title, url: u });
        if (items.length>=30) break;
      }
      if (items.length) return { ok:true, list: items, via:"sitemap-detail", tried };
    }catch(e){
      tried.push({ url: getter===fetchText ? sm : toProxy(sm), error: String(e) });
    }
  }
  return { ok:false, list:[], via:"sitemap-detail", tried };
}

export async function tryFetchListWithDebug(){
  const r = await fetchFromSitemap();
  if (r.ok) return { ok:true, url:"https://upbit.com/sitemap.xml", list:r.list, tried:r.tried, via:r.via };
  return { ok:false, url:null, list:[], tried:r.tried };
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
      confidence: via==="sitemap-detail" ? 0.6 : 0.7,
      starts_at: new Date().toISOString(),
      _via: via
    });
  }
  return events;
}
