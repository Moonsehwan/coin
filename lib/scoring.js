import { clamp } from "./util.js";
const TYPE_BASE = { listing: 5, maintenance: -1, caution: -2, delist: -4, hack: -5, mainnet: 4, other: 1 };
const TYPE_POL  = { listing: "bull", mainnet: "bull", maintenance: "neutral", caution: "bear", delist: "bear", hack: "bear", other: "neutral" };
export function scoreEvent({ category="other" }) {
  const base = TYPE_BASE[category] ?? 1;
  const impact = clamp(base + 3, 0, 10); // ?? ???
  const polarity = TYPE_POL[category] ?? "neutral";
  const confidence = 0.9;
  return { impact, polarity, confidence };
}