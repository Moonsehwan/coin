// lib/sources/upbit_coincarp.js
const UA = "Mozilla/5.0 CoinCalendarBot/ccarp/1.0";

function inferCategoryAndImpact(title=""){
  const t = title;
  const has = (s)=>t.includes(s);
  let category="other", polarity="neutral", impact=5;
  if (has("상장") || /list(ing)?/i.test(t)) { category="listing"; polarity="bull"; impact=8; }
  else if (has("상폐") || has("유의") || /delist/i.test(t)) { category="delist"; polarity="bear"; impact=9; }
  else if (has("입출금") || has("지갑") || /deposit|withdraw/i.test(t)) { category="wallet"; impact=6; }
  else if (has("점검") || has("중단") || has("재개") || /suspend|resume/i.test(t)) { category="maintenance"; impact=5; }
  else if (has("업그레이드") || has("하드포크") || has("메인넷") || /upgrade|fork/i.test(t)) { category="upgrade"; impact=7; }
  else if (has("보안") || has("해킹") || has("익스플로잇")) { category="security"; polarity="bear"; impact=9; }
  else if (has("거버넌스") || has("소각") || has("발행") || has("수수료") || has("유동성")) { category="governance"; impact=7; }
  else if (has("파트너십") || has("제휴") || /partnership/i.test(t)) { category="partnership"; impact=6; }
  return { category, polarity, impact };
}

function extractSymbols(title=""){
  // 대괄호/괄호/대문자 토큰에서 심볼 추정
  const syms = new Set();
  (title.match(/\(([A-Z0-9\/,\s-]{2,})\)/g) || []).forEach(g=>{
    g.replace(/[()]/g,"").split(/[\/,\s·・,]+/).forEach(s=>{
      const x=s.trim().toUpperCase();
      if (/^[A-Z0-9]{2,10}$/.test(x)) syms.add(x);
    });
  });
  return Array.from(syms).slice(0,8);
}

async function fetchText(url){
  const r = await fetch(url, { headers: { "user-agent": UA, "accept": "text/html,*/*" }});
  if (!r.ok) return null;
  return await r.text();
}

function parseCoinCarpList(html){
  // CoinCarp Upbit 공지 목록에서 카드/리스트 앵커 추출
  // 링크 패턴 예시: /exchange/upbit/announcement/xxxxxx/
  const out=[]; const seen=new Set();
  const re = /<a[^>]+href="(\/exchange\/upbit\/announcement\/[^"]+)"[^>]*>(.*?)<\/a>/gi;
  let m;
  while((m=re.exec(html))!==null){
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim();
    if (!text) continue;
    const url = "https://www.coincarp.com" + href;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title:text });
  }
  return out;
}

export async function fetchUpbitFromCoinCarp(){
  // 1차: 직접, 2차: r.jina.ai 프록시
  const direct = await fetchText("https://www.coincarp.com/exchange/upbit/announcement/");
  let html = direct;
  if (!html) {
    html = await fetchText("https://r.jina.ai/http/https://www.coincarp.com/exchange/upbit/announcement/");
  }
  if (!html) return [];

  const rows = parseCoinCarpList(html).slice(0,50);
  const events = rows.map(({url, title})=>{
    const { category, polarity, impact } = inferCategoryAndImpact(title);
    const symbols = extractSymbols(title);
    return {
      source: "Upbit (via CoinCarp)",
      source_id: url,
      title,
      url,
      symbols,
      category,
      polarity,
      impact,
      confidence: 0.55,         // 3rd-party 경유이므로 약간 낮게
      starts_at: new Date().toISOString()
    };
  });
  return events;
}
