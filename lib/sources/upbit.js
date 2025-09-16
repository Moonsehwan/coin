// lib/sources/upbit.js — announcements first, notices fallback, sitemap last
const UA = "Mozilla/5.0 CoinCalendarBot/1.2";
const ORIGIN = "https://upbit.com";
const REFERER = "https://upbit.com/service_center/notice";

async function jget(url){
  const r = await fetch(url, { headers: { "user-agent":UA, "origin":ORIGIN, "referer":REFERER, "accept":"application/json,text/html,*/*" }});
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("json") ? await r.json().catch(()=>null) : await r.text().catch(()=>null);
  return { ok:r.ok, status:r.status, url, body };
}

function normalize(it){
  const title = it.title || it.subject || it.name || "";
  const id = String(it.id ?? it.noticeId ?? it.uuid ?? it.slug ?? it.url ?? title);
  const created = it.created_at || it.createdAt || it.reg_dt || it.timestamp || Date.now();
  // 심볼 후보(괄호/대문자)
  const syms = new Set();
  (title.match(/\(([^)]+)\)/g) || []).forEach(g=>{
    g.replace(/[()]/g,"").split(/[\/,\s·・,]+/).forEach(s=>{ if(/^[A-Z0-9]{2,10}$/.test(s)) syms.add(s); });
  });
  // 카테고리 추정
  const t = title;
  const has=(kw)=>t.includes(kw);
  let category="other", impact=5, polarity="neutral";
  if (has("상장")){category="listing";impact=8;polarity="bull";}
  else if (has("상폐")||has("유의종목")||has("유의 지정")){category="delist";impact=9;polarity="bear";}
  else if (has("입출금")||has("지갑")){category="wallet";impact=6;}
  else if (has("점검")||has("중단")||has("재개")){category="maintenance";impact=5;}
  else if (has("업그레이드")||has("하드포크")||has("메인넷")){category="upgrade";impact=7;}
  else if (has("보안")||has("해킹")||has("익스플로잇")){category="security";impact=9;polarity="bear";}
  else if (has("거버넌스")||has("소각")||has("발행")||has("수수료")||has("유동성")){category="governance";impact=7;}
  else if (has("파트너십")||has("제휴")){category="partnership";impact=6;}
  const url = it.url || it.link || it.share_url || it.path || `https://upbit.com/service_center/notice?id=${encodeURIComponent(id)}`;
  return { source:"Upbit", source_id:id, title, url, symbols:Array.from(syms).slice(0,8), category, polarity, impact, confidence:0.6, starts_at:new Date(created).toISOString() };
}

export async function fetchUpbitNotices(){
  let items=[];
  const annBase="https://api-manager.upbit.com/api/v1/announcements";
  const cats=["notice","market","wallet","policy"];
  for (const c of cats){
    const url=`${annBase}?os=moweb&page=1&per_page=50&category=${encodeURIComponent(c)}`;
    const r=await jget(url);
    if(r.ok && r.body){
      const list=r.body?.data?.list || r.body?.list || r.body?.data || [];
      if(Array.isArray(list)) items.push(...list.map(normalize));
    }
  }
  // 구버전 notices도 시도(혹시 열려있으면 일부라도 수집)
  if(items.length===0){
    const oldBase="https://api-manager.upbit.com/api/v1/notices";
    const ths=["general","wallet","market","policy"];
    for(const th of ths){
      const url=`${oldBase}?page=1&per_page=50&thread_name=${encodeURIComponent(th)}`;
      const r=await jget(url);
      if(r.ok && r.body){
        const list=r.body?.data?.list || r.body?.list || r.body?.data || [];
        if(Array.isArray(list)) items.push(...list.map(normalize));
      }
    }
  }
  // sitemap 최후방어
  if(items.length===0){
    const r=await jget("https://upbit.com/sitemap.xml");
    if(r.ok && typeof r.body==="string"){
      const urls=Array.from(r.body.matchAll(/<loc>([^<]+service_center[^<]+)<\/loc>/g)).slice(0,50).map(m=>m[1]);
      items = urls.map(u=>({source:"Upbit",source_id:u,title:"공지",url:u,symbols:[],category:"other",polarity:"neutral",impact:5,confidence:0.5,starts_at:new Date().toISOString()}));
    }
  }
  // dedup by source_id
  const seen=new Set(); const out=[];
  for(const it of items){ if(seen.has(it.source_id)) continue; seen.add(it.source_id); out.push(it); }
  return out;
}
