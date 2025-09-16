// lib/sources/bithumb_coincarp.js
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CoinCalendarBot/1.7";
async function fetchText(url){
  try{
    const r = await fetch(url, { headers:{ "user-agent": UA, "accept":"text/html,*/*" }});
    if(!r.ok) return null;
    return await r.text();
  }catch{ return null; }
}
function parseList(html){
  if(!html) return [];
  const out=[], seen=new Set();
  const re1 = /<a[^>]+href="(\/exchange\/bithumb\/announcement\/[^"]+)"[^>]*>(.*?)<\/a>/gi;
  let m1; while((m1=re1.exec(html))!==null){
    const url = "https://www.coincarp.com"+m1[1];
    if(seen.has(url)) continue; seen.add(url);
    const title = m1[2].replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim();
    if(title) out.push({url,title});
  }
  const re2 = /href="(\/exchange\/bithumb\/announcement\/[^"]+)"[^>]*>[\s\S]{0,300}?>([^<]{3,200})<\/a>/gi;
  let m2; while((m2=re2.exec(html))!==null){
    const url = "https://www.coincarp.com"+m2[1];
    if(seen.has(url)) continue; seen.add(url);
    const title = String(m2[2]||"").replace(/\s+/g," ").trim();
    if(title) out.push({url,title});
  }
  return out;
}
function toEvents(rows){
  return rows.slice(0,50).map(({url,title})=>{
    const t=title;
    const has=(s)=>t.toLowerCase().includes(s);
    let category="other", polarity="neutral", impact=5;
    if (has("상장")||/list(ing)?/i.test(t)) { category="listing"; polarity="bull"; impact=8; }
    else if (has("상폐")||has("유의")||/delist/i.test(t)) { category="delist"; polarity="bear"; impact=9; }
    else if (has("입출금")||has("지갑")||/deposit|withdraw/i.test(t)) { category="wallet"; impact=6; }
    else if (has("점검")||has("중단")||has("재개")||/suspend|resume/i.test(t)) { category="maintenance"; impact=5; }
    else if (has("업그레이드")||has("하드포크")||has("메인넷")||/upgrade|fork/i.test(t)) { category="upgrade"; impact=7; }

    const syms = new Set();
    (t.match(/\(([A-Z0-9\/,\s-]{2,})\)/g)||[]).forEach(g=>{
      g.replace(/[()]/g,"").split(/[\/,\s·・,]+/).forEach(s=>{
        const x=s.trim().toUpperCase(); if(/^[A-Z0-9]{2,10}$/.test(x)) syms.add(x);
      });
    });

    return {
      source:"Bithumb (via CoinCarp)",
      source_id:url,
      title,
      url,
      symbols:Array.from(syms).slice(0,8),
      category, polarity, impact,
      confidence:0.55,
      starts_at:new Date().toISOString()
    };
  });
}
export async function fetchBithumbFromCoinCarp(){
  const urls = [
    "https://www.coincarp.com/exchange/bithumb/announcement/",
    "https://r.jina.ai/http/https://www.coincarp.com/exchange/bithumb/announcement/",
    "https://r.jina.ai/http/www.coincarp.com/exchange/bithumb/announcement/"
  ];
  for(const u of urls){
    const html = await fetchText(u);
    const rows = parseList(html);
    if(rows.length) return toEvents(rows);
  }
  return [];
}
