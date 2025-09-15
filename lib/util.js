import crypto from "node:crypto";
export function hashObject(obj) {
  const json = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash("sha256").update(json).digest("hex");
}
export function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }