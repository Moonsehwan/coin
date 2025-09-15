export function scoreEvent({ category } = {}) {
  const cat = String(category || "").toLowerCase();
  // 카테고리별 대충의 기본값
  const base =
    cat.includes("hack") || cat.includes("exploit") ? { impact: 9, polarity: "bear" } :
    cat.includes("listing") || cat.includes("mainnet") ? { impact: 7, polarity: "bull" } :
    { impact: 5, polarity: "neutral" };
  return { impact: base.impact, polarity: base.polarity, confidence: 0.6 };
}